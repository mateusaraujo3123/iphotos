const prisma = require('../config/db');
const { consultarPagamento } = require('../utils/pix');
const { gerarUrlAssinadaDownload } = require('../config/storage');

/**
 * POST /api/pagamentos/webhook
 * Recebido do provedor de pagamento ativo (Efí ou Mercado Pago — ver
 * pix.js) sempre que o status de uma cobrança muda. A Efí pode mandar
 * VÁRIAS notificações numa chamada só (array `pix`); o Mercado Pago manda
 * uma por vez (`data.id`). Em ambos os casos, NUNCA confiamos só no corpo
 * do webhook — sempre confirmamos consultando a API do provedor antes de
 * liberar as fotos (item 2 do briefing).
 */
async function webhook(req, res) {
  try {
    const idsParaChecar = [];

    // Formato Efí: { pix: [ { txid, valor, chave, horario, ... }, ... ] }
    if (Array.isArray(req.body?.pix)) {
      for (const evento of req.body.pix) {
        if (evento?.txid) idsParaChecar.push(String(evento.txid));
      }
    }

    // Formato Mercado Pago: { data: { id: "..." } } (ou via querystring)
    const idMercadoPago = req.body?.data?.id || req.query?.['data.id'];
    if (idMercadoPago) idsParaChecar.push(String(idMercadoPago));

    if (!idsParaChecar.length) return res.sendStatus(200); // notificação irrelevante, ignora

    for (const pixTxId of idsParaChecar) {
      const pedido = await prisma.pedido.findUnique({ where: { pixTxId } });
      if (!pedido) continue;

      const pagamento = await consultarPagamento(pixTxId);

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
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook Pix:', err);
    res.sendStatus(200); // sempre 200 pro provedor não ficar reenviando em loop
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
