/**
 * "Roteador" de pagamento Pix — escolhe qual provedor usar de acordo com
 * a variável de ambiente PAYMENT_PROVIDER ('EFI' ou 'MERCADOPAGO').
 * Padrão: EFI. O resto do código (orderController, paymentController)
 * sempre importa DAQUI, nunca direto de pixEfi.js/pixMercadoPago.js —
 * assim trocar de provedor é só mudar essa variável de ambiente.
 */
const PROVEDOR_PAGAMENTO = (process.env.PAYMENT_PROVIDER || 'EFI').toUpperCase();

const implementacao =
  PROVEDOR_PAGAMENTO === 'MERCADOPAGO' ? require('./pixMercadoPago') : require('./pixEfi');

module.exports = implementacao;
