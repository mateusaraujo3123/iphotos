/**
 * Esteira de compressão + marca d'água (item 1 do briefing).
 *
 * Recebe o buffer ORIGINAL (10-20MB) enviado pelo fotógrafo e devolve
 * uma versão leve (JPEG, largura máx. configurável) com a marca "iphotos"
 * estampada de forma fixa e repetida (padrão "diagonal tile"), para
 * dificultar o recorte/remoção da marca.
 *
 * O arquivo original NUNCA é alterado — ele é gravado intacto no bucket
 * privado por fora desta função (ver storage.salvarOriginalPrivado).
 */
const sharp = require('sharp');

const LARGURA_MAX = parseInt(process.env.WATERMARK_MAX_WIDTH || '1280', 10);
const QUALIDADE = parseInt(process.env.WATERMARK_QUALITY || '78', 10);
const TEXTO_MARCA = process.env.WATERMARK_TEXT || 'iphotos';

/**
 * Monta um SVG com o texto da marca repetido em diagonal, do tamanho da imagem.
 */
function gerarSvgMarcaDagua(largura, altura) {
  const passo = Math.max(180, Math.floor(largura / 4));
  let tiles = '';
  for (let y = -altura; y < altura * 2; y += passo) {
    for (let x = -largura; x < largura * 2; x += passo) {
      tiles += `<text x="${x}" y="${y}" font-size="${Math.floor(
        passo / 6
      )}" fill="white" fill-opacity="0.35" font-family="Arial, sans-serif" font-weight="bold"
        transform="rotate(-30 ${x} ${y})">${TEXTO_MARCA}</text>`;
    }
  }

  return Buffer.from(`
    <svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
      ${tiles}
    </svg>
  `);
}

/**
 * @param {Buffer} bufferOriginal - buffer bruto do arquivo enviado
 * @returns {Promise<Buffer>} buffer JPEG comprimido e com marca d'água
 */
async function comprimirEAplicarMarcaDagua(bufferOriginal) {
  const imagem = sharp(bufferOriginal).rotate(); // .rotate() sem args = auto-orienta via EXIF
  const metadata = await imagem.metadata();

  const larguraFinal = Math.min(metadata.width || LARGURA_MAX, LARGURA_MAX);

  const redimensionada = imagem.resize({ width: larguraFinal, withoutEnlargement: true });
  const metaRedimensionada = await redimensionada
    .clone()
    .jpeg({ quality: QUALIDADE })
    .toBuffer({ resolveWithObject: true });

  const svgMarca = gerarSvgMarcaDagua(
    metaRedimensionada.info.width,
    metaRedimensionada.info.height
  );

  const resultado = await sharp(metaRedimensionada.data)
    .composite([{ input: svgMarca, gravity: 'center' }])
    .jpeg({ quality: QUALIDADE, mozjpeg: true })
    .toBuffer();

  return resultado;
}

module.exports = { comprimirEAplicarMarcaDagua };
