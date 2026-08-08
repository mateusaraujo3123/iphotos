const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { excluirObjetos, PROVEDORES_DISPONIVEIS } = require('../config/storage');

/**
 * POST /api/admin/login
 * body: { usuario, senha }
 * Login por usuário + senha master (ADMIN_USERNAME / ADMIN_PASSWORD no .env).
 */
async function loginAdmin(req, res) {
  const { usuario, senha } = req.body;
  const usuarioOk = usuario === (process.env.ADMIN_USERNAME || 'admin');
  const senhaOk = senha && senha === process.env.ADMIN_PASSWORD;
  if (!usuarioOk || !senhaOk) {
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  const token = jwt.sign({ papel: 'ADMIN' }, process.env.ADMIN_JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
}

// ---------------------------------------------------------------------
// EVENTOS / MODERAÇÃO
// ---------------------------------------------------------------------

/** GET /api/admin/eventos — catálogo completo, com data de realização */
async function listarTodosEventos(req, res) {
  const eventos = await prisma.evento.findMany({
    include: {
      fotografo: { select: { id: true, nome: true, provedorNuvem: true } },
      _count: { select: { fotos: true } },
    },
    orderBy: { criadoEm: 'desc' },
  });
  res.json(eventos);
}

/**
 * PUT /api/admin/eventos/:id/categoria
 * body: { categoria: 'vaquejada' | 'ciclismo' | 'corrida' | 'futebol' }
 * Permite ao admin realocar um evento pra outra categoria (ex: o fotógrafo
 * cadastrou uma vaquejada na categoria errada por engano).
 */
async function realocarCategoriaEvento(req, res) {
  const { categoria } = req.body;
  const CATEGORIAS_VALIDAS = ['vaquejada', 'ciclismo', 'corrida', 'futebol'];
  if (!CATEGORIAS_VALIDAS.includes(categoria)) {
    return res.status(400).json({ erro: `Categoria inválida. Use uma de: ${CATEGORIAS_VALIDAS.join(', ')}` });
  }
  const evento = await prisma.evento.update({
    where: { id: req.params.id },
    data: { categoria },
  });
  res.json(evento);
}

/**
 * DELETE /api/admin/eventos/:id — "Deletar Tudo"
 * Remove o registro do banco (cascade apaga Fotos/ItemPedido relacionados)
 * E exclui fisicamente os binários (original + público) da nuvem.
 */
async function deletarEvento(req, res) {
  const { id } = req.params;

  try {
    const evento = await prisma.evento.findUnique({
      where: { id },
      include: { fotografo: true, fotos: true },
    });
    if (!evento) return res.status(404).json({ erro: 'Evento não encontrado.' });

    // A exclusão na nuvem roda em try/catch PRÓPRIO: se falhar (ex: uma
    // chave já não existe mais, erro de rede pontual, etc.), o evento e
    // as fotos são removidos do banco mesmo assim — o clique em "Deletar
    // Tudo" nunca deve travar por causa de um erro no storage.
    try {
      const chavesPrivadas = evento.fotos.map((f) => f.chaveOriginal);
      const chavesPublicas = evento.fotos.map((f) => {
        const partes = f.urlPublica.split('/');
        const idx = partes.findIndex((p) => p === 'publico');
        return idx >= 0 ? partes.slice(idx).join('/') : f.urlPublica;
      });

      await excluirObjetos({
        provedorNuvem: evento.fotografo.provedorNuvem,
        chavesPrivadas,
        chavesPublicas,
      });
    } catch (erroStorage) {
      console.error(`[admin] Falha ao excluir binários do evento ${id} na nuvem (evento será removido do banco mesmo assim):`, erroStorage);
    }

    await prisma.evento.delete({ where: { id } }); // cascade: Foto, ItemPedido

    res.json({ mensagem: 'Evento e todas as fotos foram excluídos permanentemente.' });
  } catch (err) {
    console.error('[admin] Erro ao excluir evento:', err);
    res.status(500).json({ erro: 'Não foi possível excluir o evento. Tente novamente.' });
  }
}

// ---------------------------------------------------------------------
// GESTÃO DE FOTÓGRAFOS (roteamento multi-cloud + taxa individual)
// ---------------------------------------------------------------------

/** GET /api/admin/fotografos */
async function listarFotografos(req, res) {
  const fotografos = await prisma.usuario.findMany({
    where: { papel: 'FOTOGRAFO' },
    select: {
      id: true,
      nome: true,
      email: true,
      whatsapp: true,
      chavePix: true,
      provedorNuvem: true,
      taxaComissao: true,
      limiteArmazenamentoMB: true,
      ativo: true,
      criadoEm: true,
      _count: { select: { eventos: true } },
    },
    orderBy: { criadoEm: 'desc' },
  });

  // Soma o armazenamento usado por cada fotógrafo (bytes de todas as fotos dele)
  const fotografosComUso = await Promise.all(
    fotografos.map(async (f) => {
      const uso = await prisma.foto.aggregate({
        where: { evento: { fotografoId: f.id } },
        _sum: { tamanhoBytes: true },
      });
      const usadoMB = (uso._sum.tamanhoBytes || 0) / (1024 * 1024);
      return { ...f, armazenamentoUsadoMB: Number(usadoMB.toFixed(1)) };
    })
  );

  res.json(fotografosComUso);
}

/**
 * PUT /api/admin/fotografos/:id/limite-armazenamento
 * body: { limiteArmazenamentoMB: number }
 */
async function definirLimiteArmazenamento(req, res) {
  const { limiteArmazenamentoMB } = req.body;
  if (!limiteArmazenamentoMB || limiteArmazenamentoMB <= 0) {
    return res.status(400).json({ erro: 'Limite inválido.' });
  }
  const fotografo = await prisma.usuario.update({
    where: { id: req.params.id },
    data: { limiteArmazenamentoMB },
  });
  res.json({ id: fotografo.id, limiteArmazenamentoMB: fotografo.limiteArmazenamentoMB });
}

/**
 * PUT /api/admin/fotografos/:id/provedor-nuvem
 * body: { provedorNuvem: 'R2' | 'S3' | 'BACKBLAZE' | 'WASABI' | 'DIGITALOCEAN' | 'IDRIVE' | 'VULTR' | 'LINODE' | 'SCALEWAY' | 'SUPABASE' }
 * Roteamento multi-cloud: define em qual bucket este fotógrafo específico
 * salvará os PRÓXIMOS lotes de fotos enviados.
 */
async function definirProvedorNuvem(req, res) {
  const { provedorNuvem } = req.body;
  if (!PROVEDORES_DISPONIVEIS.includes(provedorNuvem)) {
    return res.status(400).json({ erro: `Provedor inválido. Use um de: ${PROVEDORES_DISPONIVEIS.join(', ')}` });
  }
  const fotografo = await prisma.usuario.update({
    where: { id: req.params.id },
    data: { provedorNuvem },
  });
  res.json({ id: fotografo.id, provedorNuvem: fotografo.provedorNuvem });
}

/**
 * PUT /api/admin/fotografos/:id/taxa
 * body: { taxaComissao: number }  (percentual, ex: 15 = 15%)
 * Permite ao admin alterar a taxa individualmente por fotógrafo.
 */
async function definirTaxaComissao(req, res) {
  const { taxaComissao } = req.body;
  if (taxaComissao === undefined || taxaComissao < 0 || taxaComissao > 100) {
    return res.status(400).json({ erro: 'Taxa inválida (0 a 100).' });
  }
  const fotografo = await prisma.usuario.update({
    where: { id: req.params.id },
    data: { taxaComissao },
  });
  res.json({ id: fotografo.id, taxaComissao: fotografo.taxaComissao });
}

// ---------------------------------------------------------------------
// GESTÃO DE USUÁRIOS (reset de senha / exclusão — fotógrafo ou cliente)
// ---------------------------------------------------------------------

/** GET /api/admin/usuarios */
async function listarUsuarios(req, res) {
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nome: true, email: true, papel: true, ativo: true, criadoEm: true },
    orderBy: { criadoEm: 'desc' },
  });
  res.json(usuarios);
}

/** PUT /api/admin/usuarios/:id/resetar-senha  body: { novaSenha } */
async function resetarSenha(req, res) {
  const { novaSenha } = req.body;
  if (!novaSenha || novaSenha.length < 6) {
    return res.status(400).json({ erro: 'A nova senha deve ter ao menos 6 caracteres.' });
  }
  const senhaHash = await bcrypt.hash(novaSenha, 10);
  await prisma.usuario.update({ where: { id: req.params.id }, data: { senhaHash } });
  res.json({ mensagem: 'Senha redefinida com sucesso.' });
}

/** DELETE /api/admin/usuarios/:id */
async function excluirUsuario(req, res) {
  await prisma.usuario.delete({ where: { id: req.params.id } });
  res.json({ mensagem: 'Usuário excluído permanentemente.' });
}

// ---------------------------------------------------------------------
// CUPONS DE DESCONTO
// ---------------------------------------------------------------------

/** POST /api/admin/cupons  body: { codigo, tipoDesconto, valorDesconto, limiteUsos?, expiraEm? } */
async function criarCupom(req, res) {
  const { codigo, tipoDesconto, valorDesconto, limiteUsos, expiraEm } = req.body;
  if (!codigo || !tipoDesconto || valorDesconto === undefined) {
    return res.status(400).json({ erro: 'Preencha código, tipo e valor do desconto.' });
  }
  const cupom = await prisma.cupom.create({
    data: {
      codigo: codigo.toUpperCase(),
      tipoDesconto, // 'PERCENTUAL' | 'VALOR_FIXO'
      valorDesconto,
      limiteUsos: limiteUsos || null,
      expiraEm: expiraEm ? new Date(expiraEm) : null,
    },
  });
  res.status(201).json(cupom);
}

/** GET /api/admin/cupons */
async function listarCupons(req, res) {
  const cupons = await prisma.cupom.findMany({ orderBy: { criadoEm: 'desc' } });
  res.json(cupons);
}

/** PUT /api/admin/cupons/:id/status  body: { ativo } */
async function alternarStatusCupom(req, res) {
  const cupom = await prisma.cupom.update({
    where: { id: req.params.id },
    data: { ativo: req.body.ativo },
  });
  res.json(cupom);
}

// ---------------------------------------------------------------------
// SAQUES (fila que o admin liquida no fim do dia útil, corte às 22h)
// ---------------------------------------------------------------------

/** GET /api/admin/saques?status=PENDENTE */
async function listarSaques(req, res) {
  const { status } = req.query;
  const saques = await prisma.solicitacaoSaque.findMany({
    where: status ? { status } : {},
    include: { fotografo: { select: { nome: true, email: true, whatsapp: true } } },
    orderBy: { solicitadoEm: 'asc' },
  });
  res.json(saques);
}

/** PUT /api/admin/saques/:id/pagar */
async function marcarSaquePago(req, res) {
  const saque = await prisma.solicitacaoSaque.update({
    where: { id: req.params.id },
    data: { status: 'PAGO', pagoEm: new Date() },
  });
  res.json(saque);
}

/** PUT /api/admin/saques/:id/recusar */
async function recusarSaque(req, res) {
  const saque = await prisma.solicitacaoSaque.update({
    where: { id: req.params.id },
    data: { status: 'RECUSADO' },
  });
  res.json(saque);
}

// ---------------------------------------------------------------------
// CONFIGURAÇÃO GERAL (tema / taxa base padrão)
// ---------------------------------------------------------------------

/** GET /api/admin/config */
async function obterConfig(req, res) {
  const config = await prisma.configuracaoPlataforma.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  res.json(config);
}

/** PUT /api/admin/config  body: { taxaComissaoBase?, corPrimaria? } */
async function atualizarConfig(req, res) {
  const { taxaComissaoBase, corPrimaria } = req.body;
  const config = await prisma.configuracaoPlataforma.upsert({
    where: { id: 1 },
    update: {
      ...(taxaComissaoBase !== undefined ? { taxaComissaoBase } : {}),
      ...(corPrimaria ? { corPrimaria } : {}),
    },
    create: { id: 1, taxaComissaoBase, corPrimaria },
  });
  res.json(config);
}

module.exports = {
  loginAdmin,
  listarTodosEventos,
  realocarCategoriaEvento,
  deletarEvento,
  listarFotografos,
  definirProvedorNuvem,
  definirTaxaComissao,
  definirLimiteArmazenamento,
  listarUsuarios,
  resetarSenha,
  excluirUsuario,
  criarCupom,
  listarCupons,
  alternarStatusCupom,
  listarSaques,
  marcarSaquePago,
  recusarSaque,
  obterConfig,
  atualizarConfig,
};
