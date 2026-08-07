const prisma = require('../config/db');
const { gerarCobrancaPix } = require('../utils/pix');

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

  // Gera a cobrança Pix real via Mercado Pago
  const cobranca = await gerarCobrancaPix({
    pedidoId: pedido.id,
    valor: total,
    emailCliente: usuario.email,
    nomeCliente: usuario.nome,
  });

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
async function buscarPedido(req, res) {
  const pedido = await prisma.pedido.findFirst({
    where: { id: req.params.id, clienteId: req.usuario.id },
    include: { itens: { include: { foto: { include: { evento: true } } } } },
  });
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  res.json(pedido);
}

/**
 * GET /api/pedidos — histórico de compras do cliente (minhas-compras.html)
 * Retorna apenas pedidos PAGOS, cada foto com a chave para pedir o link de download.
 */
async function minhasCompras(req, res) {
  const pedidos = await prisma.pedido.findMany({
    where: { clienteId: req.usuario.id, status: 'PAGO' },
    include: { itens: { include: { foto: { include: { evento: true } } } } },
    orderBy: { pagoEm: 'desc' },
  });
  res.json(pedidos);
}

module.exports = { criarPedido, buscarPedido, minhasCompras };
