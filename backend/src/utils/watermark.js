/**
 * Esteira de compressão + marca d'água (item 1 do briefing).
 *
 * Recebe o buffer ORIGINAL enviado pelo fotógrafo e devolve uma versão
 * leve (JPEG) com uma marca d'água em MÚLTIPLAS CAMADAS, pensada
 * especificamente para dificultar remoção automatizada por IA:
 *
 *   1) Marca principal: Seu logotipo original em PNG, centralizado e redimensionado.
 *   2) Marcas secundárias menores, espalhadas em posições/rotações/
 *      escalas/opacidades ALEATÓRIAS (com seed por foto).
 *   3) Uma textura fina de linhas, aplicada com blend "overlay".
 *   4) Uma linha pequena de aviso de direitos autorais no rodapé.
 */
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');

const LARGURA_MAX = parseInt(process.env.WATERMARK_MAX_WIDTH || '1000', 10);
const QUALIDADE = parseInt(process.env.WATERMARK_QUALITY || '68', 10);
const TEXTO_MARCA = process.env.WATERMARK_TEXT || 'iphotos';
const TEXTO_DIREITOS =
  process.env.WATERMARK_COPYRIGHT_TEXT ||
  '© iphotos — foto protegida. Reprodução e remoção da marca não autorizadas.';

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * PRNG determinístico simples (mulberry32) a partir de uma seed textual.
 */
function criarGeradorPseudoAleatorio(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * CAMADA 2 — marcas secundárias de texto espalhadas de forma randômica.
 */
function gerarMarcasSecundarias(largura, altura, rand) {
  const QUANTIDADE = 38;
  let textos = '';
  for (let i = 0; i < QUANTIDADE; i++) {
    const x = rand() * largura;
    const y = rand() * altura;
    const angulo = -55 + rand() * 110;
    const fonte = Math.max(15, Math.floor(largura / (10 + rand() * 10)));
    const opacidade = (0.16 + rand() * 0.16).toFixed(2);
    textos += `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-size="${fonte}" font-family="Arial, sans-serif" font-weight="700"
      fill="white" fill-opacity="${opacidade}" text-anchor="middle" transform="rotate(${angulo.toFixed(1)} ${x.toFixed(0)} ${y.toFixed(0)})">${escaparXml(TEXTO_MARCA)}</text>`;
  }
  return textos;
}

/**
 * CAMADA 3 — textura de linhas finas com blend "overlay".
 */
function gerarTexturaInterativa(largura, altura, rand) {
  const espacamento = Math.max(10, Math.floor(largura / 70));
  const anguloBase = 45 + (rand() - 0.5) * 12;
  let linhas = '';
  for (let x = -altura; x < largura + altura; x += espacamento) {
    linhas += `<line x1="${x}" y1="0" x2="${x + altura}" y2="${altura}" stroke="white" stroke-opacity="0.09" stroke-width="1"/>`;
  }
  return `<svg width="${largura}" height="${altura}" xmlns="http://w3.org">
    <g transform="rotate(${anguloBase.toFixed(1)} ${largura / 2} ${altura / 2})">${linhas}</g>
  </svg>`;
}

/**
 * Linha pequena de aviso de direitos autorais no rodapé.
 */
function gerarRodapeDireitos(largura, altura) {
  const fonte = Math.max(10, Math.floor(largura / 95));
  return `<text x="${largura / 2}" y="${altura - fonte}" font-size="${fonte}" font-family="Arial, sans-serif"
    fill="white" fill-opacity="0.55" text-anchor="middle">${escaparXml(TEXTO_DIREITOS)}</text>`;
}

/**
 * Função principal exportada pela esteira de processamento de imagens.
 */
async function comprimirEAplicarMarcaDagua(bufferOriginal, seed) {
  const imagem = sharp(bufferOriginal).rotate(); // Auto-orienta via EXIF
  const metadata = await imagem.metadata();

  const larguraFinal = Math.min(metadata.width || LARGURA_MAX, LARGURA_MAX);

  const redimensionada = imagem.resize({ width: larguraFinal, withoutEnlargement: true });
  const { data: bufferBase, info } = await redimensionada
    .clone()
    .jpeg({ quality: QUALIDADE })
    .toBuffer({ resolveWithObject: true });

  const rand = criarGeradorPseudoAleatorio(seed || crypto.randomUUID());
  const { width: w, height: h } = info;

  // 1. Gerar os SVGs de texto e texturas de forma isolada
  const svgTextos = `<svg width="${w}" height="${h}" xmlns="http://w3.org">
    ${gerarMarcasSecundarias(w, h, rand)}
    ${gerarRodapeDireitos(w, h)}
  </svg>`;

  const svgTextura = gerarTexturaInterativa(w, h, rand);

  // 2. Resolve o caminho absoluto a partir do diretório raiz de execução do processo do contêiner
  const caminhoPng = path.join(process.cwd(), 'src', 'utils', 'marca-agua.png');
  
  // TAMANHO DA MARCA: O logo vai ocupar 75% da largura da foto
  const larguraMarca = Math.floor(w * 0.75); 

  const marcaRedimensionada = await sharp(caminhoPng)
    .resize({ width: larguraMarca })
    .toBuffer();

  // 3. Composição final unificada aplicando o PNG por cima dos vetores
  const resultado = await sharp(bufferBase)
    .composite([
      { input: Buffer.from(svgTextura), blend: 'overlay' },
      { input: Buffer.from(svgTextos), blend: 'over' },
      { input: marcaRedimensionada, gravity: 'center', blend: 'over' }
    ])
    .jpeg({ quality: QUALIDADE, mozjpeg: true })
    .toBuffer();

  return resultado;
}

module.exports = { comprimirEAplicarMarcaDagua };
