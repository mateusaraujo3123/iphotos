const prisma = require('../config/db');
const { gerarCobrancaPix, consultarPagamento } = require('../utils/pix');

/**
 * POST /api/pedidos
 * body: { fotoIds: string[], codigoCupom?: string }
 * Cria o pedido PENDENTE, aplica cupom (se houver) e gera a cobrança Pix real.
 * Usada pelo carrinho.html no botão "Finalizar Compra".
 */
async function criarPedido(req, res) {
  const { fotoIds, codigoCupom } = req.body;

  if (!Array.isArray(fotoIds) || fotoIds.length === 0) {
    return res.status(400).json({ erro: 'Selecione ao menos uma foto.' });
  }

  const fotos = await prisma.foto.findMany({ where: { id: { in: fotoIds } } });
  if (fotos.length !== fotoIds.length) {
    return res.status(400).json({ erro: 'Uma ou mais fotos não foram encontradas.' });
  }

  const subtotal = fotos.reduce((soma, f) => soma + Number(f.preco), 0);

  let cupom = null;
  let descontoValor = 0;

  if (codigoCupom) {
    cupom = await prisma.cupom.findUnique({ where: { codigo: codigoCupom.toUpperCase() } });
    if (!cupom || !cupom.ativo) {
      return res.status(400).json({ erro: 'Cupom inválido ou inativo.' });
    }
    if (cupom.expiraEm && cupom.expiraEm < new Date()) {
      return res.status(400).json({ erro: 'Cupom expirado.' });
    }
    if (cupom.limiteUsos !== null && cupom.usosRealizados >= cupom.limiteUsos) {
      return res.status(400).json({ erro: 'Este cupom atingiu o limite de usos.' });
    }

    descontoValor =
      cupom.tipoDesconto === 'PERCENTUAL'
        ? subtotal * (Number(cupom.valorDesconto) / 100)
        : Number(cupom.valorDesconto);
    descontoValor = Math.min(descontoValor, subtotal);
  }

  const total = Math.max(0, subtotal - descontoValor);

  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });

  const pedido = await prisma.pedido.create({
    data: {
      clienteId: req.usuario.id,
      subtotal,
      descontoValor,
      total,
      cupomId: cupom?.id,
      itens: {
        create: fotos.map((f) => ({ fotoId: f.id, preco: f.preco })),
      },
    },
    include: { itens: true },
  });

  // Gera a cobrança Pix real (Efí ou Mercado Pago — ver pix.js)
  let cobranca;
  try {
    cobranca = await gerarCobrancaPix({
      pedidoId: pedido.id,
      valor: total,
      emailCliente: usuario.email,
      nomeCliente: usuario.nome,
    });
  } catch (erroPagamento) {
    console.error('[pedidos] Falha ao gerar cobrança Pix:', erroPagamento);
    // Remove o pedido PENDENTE órfão (sem cobrança nenhuma associada) e
    // avisa o cliente com uma mensagem clara — nunca deixa a requisição
    // travada nem derruba o servidor.
    await prisma.pedido.delete({ where: { id: pedido.id } });
    return res.status(502).json({
      erro: 'Não foi possível gerar o pagamento Pix no momento. Tente novamente em instantes ou avise o suporte.',
    });
  }

  const pedidoAtualizado = await prisma.pedido.update({
    where: { id: pedido.id },
    data: {
      pixTxId: cobranca.pixTxId,
      pixCopiaCola: cobranca.pixCopiaCola,
      pixQrCodeBase64: cobranca.pixQrCodeBase64,
    },
  });

  if (cupom) {
    await prisma.cupom.update({
      where: { id: cupom.id },
      data: { usosRealizados: { increment: 1 } },
    });
  }

  res.status(201).json(pedidoAtualizado);
}

/**
 * GET /api/pedidos/:id — usado por carrinho.html/sucesso.html para checar status
 */
/**
 * GET /api/pedidos/:id — usado por carrinho.html/sucesso.html para checar status
 *
 * IMPORTANTE: além de ler o status salvo no banco, essa rota também
 * confere ATIVAMENTE com o provedor de pagamento se o pedido ainda está
 * PENDENTE — assim o site funciona mesmo se o webhook não estiver
 * configurado corretamente, chegar atrasado, ou falhar por qualquer
 * motivo de rede. O webhook continua existindo (é mais rápido quando
 * funciona), mas deixou de ser um ponto único de falha.
 */
async function buscarPedido(req, res) {
  const pedido = await prisma.pedido.findFirst({
    where: { id: req.params.id, clienteId: req.usuario.id },
    include: { itens: { include: { foto: { include: { evento: true } } } } },
  });
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

  if (pedido.status === 'PENDENTE' && pedido.pixTxId) {
    try {
      const pagamento = await consultarPagamento(pedido.pixTxId);
      if (pagamento.status === 'approved') {
        const pedidoPago = await prisma.pedido.update({
          where: { id: pedido.id },
          data: { status: 'PAGO', pagoEm: new Date() },
          include: { itens: { include: { foto: { include: { evento: true } } } } },
        });
        return res.json(pedidoPago);
      }
      if (['rejected', 'cancelled'].includes(pagamento.status)) {
        const pedidoCancelado = await prisma.pedido.update({
          where: { id: pedido.id },
          data: { status: 'CANCELADO' },
          include: { itens: { include: { foto: { include: { evento: true } } } } },
        });
        return res.json(pedidoCancelado);
      }
    } catch (err) {
      // Se a checagem ativa falhar (ex: provedor fora do ar), não quebra a
      // resposta — só devolve o status que já está salvo no banco mesmo.
      console.error(`[pedidos] Falha ao verificar status ativo do pedido ${pedido.id}:`, err.message);
    }
  }

  res.json(pedido);
}

/**
 * GET /api/pedidos — histórico de compras do cliente (minhas-compras.html)
 * Retorna apenas pedidos PAGOS, cada foto com a chave para pedir o link de download.
 */
async function minhasCompras(req, res) {
  // Antes de listar, resolve pedidos PENDENTES do próprio cliente que já
  // possam ter sido pagos (mesma checagem ativa de buscarPedido) — evita
  // que uma compra paga "suma" só porque o webhook não chegou.
  const pendentes = await prisma.pedido.findMany({
    where: { clienteId: req.usuario.id, status: 'PENDENTE', pixTxId: { not: null } },
  });

  for (const pendente of pendentes) {
    try {
      const pagamento = await consultarPagamento(pendente.pixTxId);
      if (pagamento.status === 'approved') {
        await prisma.pedido.update({ where: { id: pendente.id }, data: { status: 'PAGO', pagoEm: new Date() } });
      } else if (['rejected', 'cancelled'].includes(pagamento.status)) {
        await prisma.pedido.update({ where: { id: pendente.id }, data: { status: 'CANCELADO' } });
      }
    } catch (err) {
      console.error(`[minhas-compras] Falha ao verificar pedido pendente ${pendente.id}:`, err.message);
    }
  }

  const pedidos = await prisma.pedido.findMany({
    where: { clienteId: req.usuario.id, status: 'PAGO' },
    include: { itens: { include: { foto: { include: { evento: true } } } } },
    orderBy: { pagoEm: 'desc' },
  });
  res.json(pedidos);
}

module.exports = { criarPedido, buscarPedido, minhasCompras };
