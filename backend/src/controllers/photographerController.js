const { v4: uuid } = require('uuid');
const prisma = require('../config/db');
const { comprimirEAplicarMarcaDagua } = require('../utils/watermark');
const { salvarOriginalPrivado, salvarPublico } = require('../config/storage');

const DIAS_EXPIRACAO = parseInt(process.env.DIAS_EXPIRACAO_EVENTO || '30', 10);

/**
 * POST /api/fotografo/eventos
 * body: { titulo, categoria, local, dataRealizacao, precoPorFoto }
 * Cria a cobertura. As fotos são enviadas depois em /eventos/:id/fotos.
 */
async function criarEvento(req, res) {
  const { titulo, categoria, local, dataRealizacao, precoPorFoto } = req.body;

  if (!titulo || !categoria || !local || !dataRealizacao) {
    return res.status(400).json({ erro: 'Preencha título, categoria, local e data de realização.' });
  }

  const expiraEm = new Date();
  expiraEm.setDate(expiraEm.getDate() + DIAS_EXPIRACAO);

  const evento = await prisma.evento.create({
    data: {
      titulo,
      categoria,
      local,
      dataRealizacao: new Date(dataRealizacao),
      precoPorFoto: precoPorFoto || 15.0,
      fotografoId: req.usuario.id,
      expiraEm,
    },
  });

  res.status(201).json(evento);
}

/**
 * POST /api/fotografo/eventos/:id/fotos  (multipart/form-data, campo "fotos" — múltiplos arquivos)
 *
 * Esteira de upload (item 1 do briefing):
 *  1) para cada arquivo: grava o ORIGINAL intacto no bucket PRIVADO do provedor
 *     configurado para este fotógrafo (S3 ou R2).
 *  2) gera a versão comprimida + marca d'água via Sharp e grava no bucket PÚBLICO.
 *  3) persiste a Foto no banco apontando pra `urlPublica` (exibida no mural) e
 *     `chaveOriginal` (usada só na hora do download pós-pagamento).
 */
async function enviarLoteFotos(req, res) {
  const { id: eventoId } = req.params;

  const evento = await prisma.evento.findFirst({
    where: { id: eventoId, fotografoId: req.usuario.id },
  });
  if (!evento) return res.status(404).json({ erro: 'Evento não encontrado.' });

  const fotografo = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });

  const arquivos = req.files || [];
  if (!arquivos.length) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });

  const fotosSalvas = [];

  for (const arquivo of arquivos) {
    const idFoto = uuid();
    const extensao = arquivo.mimetype === 'image/png' ? 'png' : 'jpg';
    const chaveOriginal = `originais/${eventoId}/${idFoto}.${extensao}`;
    const chavePublica = `publico/${eventoId}/${idFoto}.jpg`;

    // 1) original intacto -> bucket privado
    await salvarOriginalPrivado({
      provedorNuvem: fotografo.provedorNuvem,
      chave: chaveOriginal,
      buffer: arquivo.buffer,
      contentType: arquivo.mimetype,
    });

    // 2) compressão + marca d'água -> bucket público
    const bufferComprimido = await comprimirEAplicarMarcaDagua(arquivo.buffer);
    const urlPublica = await salvarPublico({
      provedorNuvem: fotografo.provedorNuvem,
      chave: chavePublica,
      buffer: bufferComprimido,
      contentType: 'image/jpeg',
    });

    // 3) persiste no banco
    const foto = await prisma.foto.create({
      data: {
        eventoId,
        chaveOriginal,
        urlPublica,
        preco: evento.precoPorFoto,
      },
    });
    fotosSalvas.push(foto);
  }

  // Define a primeira foto enviada como capa do evento, se ainda não houver
  if (!evento.fotoCapaUrl && fotosSalvas.length) {
    await prisma.evento.update({
      where: { id: eventoId },
      data: { fotoCapaUrl: fotosSalvas[0].urlPublica },
    });
  }

  res.status(201).json({ mensagem: `${fotosSalvas.length} fotos processadas.`, fotos: fotosSalvas });
}

/**
 * GET /api/fotografo/eventos — lista as coberturas do fotógrafo logado
 */
async function meusEventos(req, res) {
  const eventos = await prisma.evento.findMany({
    where: { fotografoId: req.usuario.id },
    include: { _count: { select: { fotos: true } } },
    orderBy: { criadoEm: 'desc' },
  });
  res.json(eventos);
}

/**
 * GET /api/fotografo/faturamento
 *
 * Regra de negócio (item 3): não existe "saldo aguardando liberação" — tudo
 * que já foi vendido está disponível imediatamente. O valor exibido já vem
 * com o desconto da taxa de comissão individual do fotógrafo (item extra
 * pedido pelo usuário: "faturamento já somado com o desconto das taxas").
 */
async function faturamento(req, res) {
  const fotografo = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });

  const itensVendidos = await prisma.itemPedido.findMany({
    where: {
      pedido: { status: 'PAGO' },
      foto: { evento: { fotografoId: req.usuario.id } },
    },
    select: { preco: true },
  });

  const brutoVendido = itensVendidos.reduce((soma, item) => soma + Number(item.preco), 0);
  const taxaPercentual = Number(fotografo.taxaComissao);
  const valorTaxa = brutoVendido * (taxaPercentual / 100);
  const liquidoDisponivel = brutoVendido - valorTaxa;

  const jaSacado = await prisma.solicitacaoSaque.aggregate({
    where: { fotografoId: req.usuario.id, status: { in: ['PENDENTE', 'PAGO'] } },
    _sum: { valor: true },
  });

  const saldoDisponivel = liquidoDisponivel - Number(jaSacado._sum.valor || 0);

  res.json({
    totalBrutoVendido: brutoVendido,
    taxaComissaoPercentual: taxaPercentual,
    valorDescontadoEmTaxas: valorTaxa,
    totalLiquido: liquidoDisponivel,
    jaSolicitadoEmSaques: Number(jaSacado._sum.valor || 0),
    saldoDisponivelParaSaque: Math.max(0, saldoDisponivel),
  });
}

/**
 * PUT /api/fotografo/perfil — atualizar Chave Pix e WhatsApp
 */
async function atualizarPerfil(req, res) {
  const { chavePix, whatsapp } = req.body;
  const usuario = await prisma.usuario.update({
    where: { id: req.usuario.id },
    data: {
      ...(chavePix !== undefined ? { chavePix } : {}),
      ...(whatsapp !== undefined ? { whatsapp } : {}),
    },
  });
  res.json({ id: usuario.id, chavePix: usuario.chavePix, whatsapp: usuario.whatsapp });
}

/**
 * POST /api/fotografo/saques
 * body: { valor }
 * Regra de negócio (item 3): a solicitação entra em fila para o admin liquidar
 * manual/automaticamente às 22h do dia útil (ver src/jobs — liquidação é feita
 * pelo admin marcando como PAGO; o horário de corte é operacional/admin).
 */
async function solicitarSaque(req, res) {
  const { valor } = req.body;
  const fotografo = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });

  if (!fotografo.chavePix) {
    return res.status(400).json({ erro: 'Cadastre sua Chave Pix antes de solicitar saque.' });
  }
  if (!valor || valor <= 0) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }

  const saque = await prisma.solicitacaoSaque.create({
    data: {
      fotografoId: req.usuario.id,
      valor,
      chavePix: fotografo.chavePix,
    },
  });

  res.status(201).json(saque);
}

/**
 * GET /api/fotografo/saques — histórico de solicitações do fotógrafo logado
 */
async function meusSaques(req, res) {
  const saques = await prisma.solicitacaoSaque.findMany({
    where: { fotografoId: req.usuario.id },
    orderBy: { solicitadoEm: 'desc' },
  });
  res.json(saques);
}

module.exports = {
  criarEvento,
  enviarLoteFotos,
  meusEventos,
  faturamento,
  atualizarPerfil,
  solicitarSaque,
  meusSaques,
};
