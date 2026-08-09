/**
 * Integração de pagamento Pix via Efí (antiga Gerencianet).
 * Documentação: https://dev.efipay.com.br/docs/api-pix/cobrancas-imediatas/
 *
 * A Efí usa mTLS: toda chamada exige um CERTIFICADO (.p12) baixado do
 * painel da sua conta Efí (Menu > API > Meus Certificados). Pra não
 * precisar subir esse arquivo sensível no repositório, este código lê o
 * certificado em BASE64 direto de uma variável de ambiente
 * (EFI_CERTIFICADO_BASE64) — o próprio SDK da Efí aceita isso nativamente
 * (opção cert_base64: true), sem precisar salvar arquivo em disco.
 */
const EfiPay = require('sdk-node-apis-efi');

let clienteEfi = null;

function obterClienteEfi() {
  const clientId = process.env.EFI_CLIENT_ID;
  const clientSecret = process.env.EFI_CLIENT_SECRET;
  const certificadoBase64 = process.env.EFI_CERTIFICADO_BASE64;

  if (!clientId || !clientSecret || !certificadoBase64) {
    throw new Error(
      'Efí não configurada (faltam EFI_CLIENT_ID, EFI_CLIENT_SECRET ou EFI_CERTIFICADO_BASE64 no .env/Railway).'
    );
  }

  if (!clienteEfi) {
    clienteEfi = new EfiPay({
      sandbox: process.env.EFI_SANDBOX === 'true',
      client_id: clientId,
      client_secret: clientSecret,
      certificate: certificadoBase64,
      cert_base64: true,
    });
  }
  return clienteEfi;
}

/**
 * Cria uma cobrança Pix imediata e devolve o "copia e cola" + QR Code.
 * @param {{ pedidoId: string, valor: number, emailCliente: string, nomeCliente: string }} params
 */
async function gerarCobrancaPix({ pedidoId, valor, nomeCliente }) {
  const chavePix = process.env.EFI_CHAVE_PIX;
  if (!chavePix) {
    throw new Error('EFI_CHAVE_PIX não configurada (a chave Pix cadastrada na sua conta Efí).');
  }

  const efipay = obterClienteEfi();

  const corpoCobranca = {
    calendario: { expiracao: 3600 }, // 1 hora pra pagar
    valor: { original: Number(valor).toFixed(2) },
    chave: chavePix,
    solicitacaoPagador: `iphotos - Pedido ${pedidoId}`.slice(0, 140),
  };

  const cobranca = await efipay.pixCreateImmediateCharge({}, corpoCobranca);
  const qrcode = await efipay.pixGenerateQRCode({ id: cobranca.loc.id });

  return {
    pixTxId: cobranca.txid,
    pixCopiaCola: qrcode.qrcode,
    // o SDK devolve "data:image/png;base64,...."; guardamos só a parte base64 pura,
    // igual ao formato que o Mercado Pago já devolvia, pro frontend não precisar mudar
    pixQrCodeBase64: (qrcode.imagemQrcode || '').replace(/^data:image\/png;base64,/, ''),
    status: 'pending',
  };
}

/**
 * Consulta o status atual de uma cobrança na Efí pelo txid — usado pelo
 * webhook pra confirmar antes de liberar as fotos (nunca confia só no
 * conteúdo bruto do webhook).
 */
async function consultarPagamento(txid) {
  const efipay = obterClienteEfi();
  const detalhe = await efipay.pixDetailCharge({ txid });

  const MAPA_STATUS = {
    CONCLUIDA: 'approved',
    ATIVA: 'pending',
    REMOVIDA_PELO_USUARIO_RECEBEDOR: 'cancelled',
    REMOVIDA_PELO_PSP: 'cancelled',
  };

  return { status: MAPA_STATUS[detalhe.status] || 'pending' };
}

/**
 * Registra/atualiza a URL de webhook na Efí pra essa chave Pix — só
 * precisa rodar uma vez (ver rota de admin). Reexecutar não tem problema,
 * apenas atualiza a URL cadastrada.
 */
async function registrarWebhook(urlWebhook) {
  const chavePix = process.env.EFI_CHAVE_PIX;
  if (!chavePix) throw new Error('EFI_CHAVE_PIX não configurada.');

  const efipay = obterClienteEfi();
  await efipay.pixConfigWebhook({ chave: chavePix }, { webhookUrl: urlWebhook });
}

module.exports = { gerarCobrancaPix, consultarPagamento, registrarWebhook };
