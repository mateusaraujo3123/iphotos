/**
 * Integração de pagamento Pix real via Mercado Pago.
 * Documentação: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/payment-methods/pix
 *
 * Por que Mercado Pago: é o provedor mais usado no Brasil para Pix via API,
 * tem taxa competitiva, aceita CPF/CNPJ de pessoa física para recebimento
 * e devolve o "copia e cola" + QR Code prontos — sem precisar de conta em banco
 * homologada como Direct PSP.
 *
 * Troque por Efí (Gerencianet), Asaas, Pagar.me ou Stripe se preferir —
 * a interface (gerarCobrancaPix / validarWebhook) foi pensada para ser
 * facilmente substituível.
 */
const { MercadoPagoConfig, Payment } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});
const paymentClient = new Payment(client);

/**
 * Cria uma cobrança Pix e retorna o código "copia e cola" + QR Code em base64.
 * @param {{ pedidoId: string, valor: number, emailCliente: string, nomeCliente: string }} params
 */
async function gerarCobrancaPix({ pedidoId, valor, emailCliente, nomeCliente }) {
  const resposta = await paymentClient.create({
    body: {
      transaction_amount: Number(valor.toFixed(2)),
      description: `iphotos - Pedido ${pedidoId}`,
      payment_method_id: 'pix',
      payer: {
        email: emailCliente,
        first_name: nomeCliente?.split(' ')[0] || 'Cliente',
      },
      external_reference: pedidoId,
      // Notifica nosso backend quando o pagamento mudar de status
      notification_url: `${process.env.BACKEND_PUBLIC_URL || ''}/api/pagamentos/webhook`,
    },
  });

  const dadosPix = resposta.point_of_interaction?.transaction_data;

  return {
    pixTxId: String(resposta.id),
    pixCopiaCola: dadosPix?.qr_code,
    pixQrCodeBase64: dadosPix?.qr_code_base64,
    status: resposta.status, // "pending" até o cliente pagar
  };
}

/**
 * Consulta o status atual de um pagamento no Mercado Pago (usado pelo webhook
 * para confirmar a notificação antes de liberar as fotos).
 */
async function consultarPagamento(pixTxId) {
  const resposta = await paymentClient.get({ id: pixTxId });
  return resposta; // resposta.status: "approved" | "pending" | "rejected" | ...
}

module.exports = { gerarCobrancaPix, consultarPagamento };
