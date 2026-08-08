const sharp = require('sharp');
const path = require('path');

const LARGURA_MAX = parseInt(
  process.env.WATERMARK_MAX_WIDTH || '1000',
  10
);

const QUALIDADE = parseInt(
  process.env.WATERMARK_QUALITY || '75',
  10
);

const WATERMARK_PATH = path.join(__dirname, 'watermark.png');


async function comprimirEAplicarMarcaDagua(bufferOriginal) {

  // FOTO ORIGINAL
  const imagem = sharp(bufferOriginal).rotate();

  const metadata = await imagem.metadata();

  // Largura máxima da foto
  const larguraFinal = Math.min(
    metadata.width || LARGURA_MAX,
    LARGURA_MAX
  );

  // Redimensiona a foto
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


  // =====================================================
  // MARCA D'ÁGUA PNG DO PHOTOSHOP
  // =====================================================

  const watermark = await sharp(WATERMARK_PATH)
    .ensureAlpha()
    .resize({
      width: largura,
      withoutEnlargement: true
    })
    .png()
    .toBuffer();


  // =====================================================
  // APLICA A MARCA
  // =====================================================

  const resultado = await sharp(bufferBase)
    .composite([
      {
        input: watermark,
        blend: 'over',
        gravity: 'center'
      }
    ])
    .jpeg({
      quality: QUALIDADE,
      mozjpeg: true
    })
    .toBuffer();


  return resultado;
}


module.exports = {
  comprimirEAplicarMarcaDagua
};
