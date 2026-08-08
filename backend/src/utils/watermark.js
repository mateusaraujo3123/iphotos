/**
 * Esteira de compressão + marca d'água (item 1 do briefing).
 *
 * Recebe o buffer ORIGINAL enviado pelo fotógrafo e devolve uma versão
 * leve (JPEG) com uma marca d'água em MÚLTIPLAS CAMADAS, pensada
 * especificamente para dificultar remoção automatizada por IA:
 *
 *   1) Marca principal: Seu arquivo SVG personalizado centralizado e dinâmico.
 *   2) Marcas secundárias menores, espalhadas em posições/rotações/
 *      escalas/opacidades ALEATÓRIAS (com seed por foto).
 *   3) Uma textura fina de linhas, aplicada com blend "overlay".
 *   4) Uma linha pequena de aviso de direitos autorais no rodapé.
 */
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

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
 * CAMADA 1 — Carrega o seu arquivo SVG personalizado e ajusta a escala dele para o centro da foto.
 */
function obterMarcaPrincipalSvg(larguraFoto, alturaFoto) {
  const caminhoSvg = path.join(__dirname, 'marca-dagua.svg');
  
  // Lemos o conteúdo do seu arquivo SVG como texto
  let conteudoSvg = fs.readFileSync(caminhoSvg, 'utf-8');

  // Remove tags de abertura/fechamento do SVG original se existirem, para embutir no nosso container
  conteudoSvg = conteudoSvg
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '');

  // DEFINA O TAMANHO DA SUA MARCA: 0.75 significa que ela ocupará 75% da largura da foto
  const larguraMarca = Math.floor(larguraFoto * 0.75);
  
  // Centralização matemática simples do elemento gráfico
  const cx = larguraFoto / 2;
  const cy = alturaFoto / 2;

  // Embutimos o seu SVG dentro de uma tag <g> (grupo) aplicando opacidade e escala controladas
  return `<g fill="white" opacity="0.45" transform="translate(${cx}, ${cy}) scale(${larguraMarca / 500}) translate(-250, -250)">
    ${conteudoSvg}
  </g>`;
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

  // Junta o seu SVG com as marcas secundárias e o rodapé num único arquivo de texto SVG
  const svgTextos = `<svg width="${w}" height="${h}" xmlns="http://w3.org">
    ${gerarMarcasSecundarias(w, h, rand)}
    ${obterMarcaPrincipalSvg(w, h)}
    ${gerarRodapeDireitos(w, h)}
  </svg>`;

  const svgTextura = gerarTexturaInterativa(w, h, rand);

  // Processa tudo em um único bloco de composição rápido e nativo
  const resultado = await sharp(bufferBase)
    .composite([
      { input: Buffer.from(svgTextura), blend: 'overlay' }, // Camada de textura nos pixels
      { input: Buffer.from(svgTextos), blend: 'over' }      // Camada unificada de todos os vetores/textos
    ])
    .jpeg({ quality: QUALIDADE, mozjpeg: true })
    .toBuffer();

  return resultado;
}

module.exports = { comprimirEAplicarMarcaDagua };
