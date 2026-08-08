/**
 * Esteira de compressão + marca d'água
 *
 * Usa uma marca d'água PNG criada externamente
 * (ex.: Photoshop) e aplica sobre a imagem.
 *
 * O arquivo original nunca é alterado.
 */

const sharp = require('sharp');
const path = require('path');

const LARGURA_MAX = parseInt(
  process.env.WATERMARK_MAX_WIDTH || '1000',
  10
);

const QUALIDADE = parseInt(
  process.env.WATERMARK_QUALITY || '10',
  10
);

// PNG criado no Photoshop
const WATERMARK_PATH = path.join(
  __dirname,
  'watermark.png'
);

/**
 * Comprime a imagem e aplica a marca d'água PNG.
 *
 * @param {Buffer} bufferOriginal
 * @returns {Promise<Buffer>} JPEG final
 */
async function comprimirEAplicarMarcaDagua(bufferOriginal) {

  // ---------------------------------------------------------
  // 1. Carrega a imagem original
  // ---------------------------------------------------------

  const imagem = sharp(bufferOriginal).rotate();

  const metadata = await imagem.metadata();

  // ---------------------------------------------------------
  // 2. Define a largura final
  // ---------------------------------------------------------

  const larguraFinal = Math.min(
    metadata.width || LARGURA_MAX,
    LARGURA_MAX
  );

  // ---------------------------------------------------------
  // 3. Redimensiona e comprime a foto
  // ---------------------------------------------------------

  const {
    data: bufferBase,
    info
  } = await imagem
    .resize({
      width: larguraFinal,
      withoutEnlargement: true
    })
    .jpeg({
      quality: QUALIDADE
    })
    .toBuffer({
      resolveWithObject: true
    });

  const largura = info.width;
  const altura = info.height;

  // ---------------------------------------------------------
  // 4. Carrega o PNG criado no Photoshop
  // ---------------------------------------------------------

  const watermark = await sharp(WATERMARK_PATH)
    .resize({
      width: largura,
      height: altura,
      fit: 'contain',
      position: 'centre'
    })
    .png()
    .toBuffer();

  // ---------------------------------------------------------
  // 5. Aplica o PNG sobre a fotografia
  // ---------------------------------------------------------

  const resultado = await sharp(bufferBase)
    .composite([
      {
        input: watermark,
        blend: 'over'
      }
    ])
    .jpeg({
      quality: QUALIDADE,
      mozjpeg: true
    })
    .toBuffer();

  // ---------------------------------------------------------
  // 6. Retorna o JPEG final
  // ---------------------------------------------------------

  return resultado;
}

module.exports = {
  comprimirEAplicarMarcaDagua
};
