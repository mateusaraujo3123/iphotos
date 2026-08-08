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

const WATERMARK_PATH = path.join(
  __dirname,
  'watermark.png'
);


async function comprimirEAplicarMarcaDagua(bufferOriginal) {

  // =====================================================
  // 1. CARREGA A FOTO ORIGINAL
  // =====================================================

  const imagem = sharp(bufferOriginal).rotate();

  const metadata = await imagem.metadata();


  // =====================================================
  // 2. DEFINE O TAMANHO FINAL DA FOTO
  // =====================================================

  const larguraFinal = Math.min(
    metadata.width || LARGURA_MAX,
    LARGURA_MAX
  );


  // =====================================================
  // 3. REDIMENSIONA E COMPRIME A FOTO
  // =====================================================

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
  // 4. CARREGA A MARCA D'ÁGUA DO PHOTOSHOP
  // =====================================================

  const watermark = await sharp(WATERMARK_PATH)
    .ensureAlpha()

    // Faz o PNG ocupar EXATAMENTE a área da foto.
    // "cover" mantém a proporção do PNG e corta
    // apenas o excesso necessário.
    .resize({
      width: largura,
      height: altura,
      fit: 'cover',
      position: 'center'
    })

    .png()
    .toBuffer();


  // =====================================================
  // 5. APLICA A MARCA D'ÁGUA
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


  // =====================================================
  // 6. RETORNA A FOTO FINAL
  // =====================================================

  return resultado;
}


module.exports = {
  comprimirEAplicarMarcaDagua
};
