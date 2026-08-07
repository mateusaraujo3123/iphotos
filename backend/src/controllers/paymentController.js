const prisma = require('../config/db');
const { consultarPagamento } = require('../utils/pix');
const { gerarUrlAssinadaDownload } = require('../config/storage');

/**
 * POST /api/pagamentos/webhook
 * Recebido do Mercado Pago sempre que o status de um pagamento muda.
 * Ao confirmar "approved", libera as fotos do pedido na conta do cliente
 * (item 2 do briefing).
 */
async function webhook(req, res) {
  try {
    const pixTxId = req.body?.data?.id || req.query?.['data.id'];
    if (!pixTxId) return res.sendStatus(200); // notificação irrelevante, ignora

    const pagamento = await consultarPagamento(pixTxId);

    const pedido = await prisma.pedido.findUnique({ where: { pixTxId: String(pixTxId) } });
    if (!pedido) return res.sendStatus(200);

    if (pagamento.status === 'approved' && pedido.status !== 'PAGO') {
      await prisma.pedido.update({
        where: { id: pedido.id },
        data: { status: 'PAGO', pagoEm: new Date() },
      });
    } else if (['rejected', 'cancelled'].includes(pagamento.status)) {
      await prisma.pedido.update({
        where: { id: pedido.id },
        data: { status: 'CANCELADO' },
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook Pix:', err);
    res.sendStatus(200); // sempre 200 pro Mercado Pago não ficar reenviando em loop
  }
}

/**
 * GET /api/fotos/:id/download
 * Botão "Baixar em Alta Resolução" — só libera se o cliente comprou e o pedido
 * está PAGO. Gera uma URL assinada e temporária (5 min) para o arquivo original.
 */
async function gerarLinkDownload(req, res) {
  const { id: fotoId } = req.params;

  const item = await prisma.itemPedido.findFirst({
    where: {
      fotoId,
      pedido: { clienteId: req.usuario.id, status: 'PAGO' },
    },
    include: { foto: { include: { evento: { include: { fotografo: true } } } } },
  });

  if (!item) {
    return res.status(403).json({ erro: 'Você ainda não comprou esta foto ou o pagamento não foi confirmado.' });
  }

  const url = await gerarUrlAssinadaDownload({
    provedorNuvem: item.foto.evento.fotografo.provedorNuvem,
    chave: item.foto.chaveOriginal,
    expiresInSeconds: 300,
  });

  res.json({ url, expiraEmSegundos: 300 });
}

module.exports = { webhook, gerarLinkDownload };
