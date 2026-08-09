/**
 * Esteira de compressão + marca d'água (item 1 do briefing).
 *
 * Recebe o buffer ORIGINAL enviado pelo fotógrafo e devolve uma versão
 * leve (JPEG) com uma marca d'água em MÚLTIPLAS CAMADAS, pensada
 * especificamente para dificultar remoção automatizada por IA
 * (inpainting / object removal):
 *
 *   1) Marca principal grande, atravessando uma faixa diagonal relevante
 *      da foto (não fica restrita a um canto).
 *   2) Marcas secundárias menores, espalhadas em posições/rotações/
 *      escalas/opacidades ALEATÓRIAS (com seed por foto) — isso evita que
 *      exista um "molde" único de remoção que funcione pra todas as fotos
 *      do mesmo evento/fotógrafo.
 *   3) Uma textura fina de linhas, aplicada com blend "overlay" (não
 *      transparência simples) — isso faz a marca interagir com o
 *      contraste/luminância dos próprios pixels da foto, em vez de ser
 *      uma camada uniforme "colada em cima" (que é o tipo de camada mais
 *      fácil de isolar e apagar automaticamente).
 *   4) Uma linha pequena de aviso de direitos autorais no rodapé —
 *      apenas INFORMATIVA, não é proteção técnica.
 *
 * IMPORTANTE (limitações — ver README/CHANGELOG): isto NÃO é uma
 * "perturbação adversarial" no sentido acadêmico (esse tipo de técnica
 * exige treinar um ataque contra um modelo de IA específico, com GPU e
 * Python/PyTorch, e nem essas técnicas de pesquisa são garantidas contra
 * modelos novos). O que existe aqui são práticas de robustez de marca
 * d'água (multi-camada, aleatória, com interação de pixel) que aumentam
 * o esforço/qualidade perdida numa remoção automatizada, mas não
 * garantem 100% de proteção contra ferramentas avançadas de inpainting.
 *
 * O arquivo original NUNCA é alterado — ele é gravado intacto no bucket
 * privado por fora desta função (ver storage.salvarOriginalPrivado).
 */
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LARGURA_MAX = parseInt(process.env.WATERMARK_MAX_WIDTH || '1000', 10);
const QUALIDADE = parseInt(process.env.WATERMARK_QUALITY || '68', 10);
const TEXTO_MARCA = process.env.WATERMARK_TEXT || 'iphotos';
const TEXTO_DIREITOS =
  process.env.WATERMARK_COPYRIGHT_TEXT ||
  '© iphotos — foto protegida. Reprodução e remoção da marca não autorizadas.';

// ============================================================
// MARCA D'ÁGUA EM PNG (opcional) — pra usar, só suba um arquivo
// PNG (fundo transparente) em backend/src/assets/marca-dagua.png
// no repositório. Se o arquivo não existir, essa camada é
// simplesmente ignorada e o resto do site funciona normal.
// ============================================================
const CAMINHO_MARCA_PNG = process.env.WATERMARK_PNG_PATH || path.join(__dirname, '../assets/marca-dagua.png');
let bufferMarcaPngOriginal = null;
try {
  bufferMarcaPngOriginal = fs.readFileSync(CAMINHO_MARCA_PNG);
  console.log(`[watermark] marca-d'água em PNG encontrada em ${CAMINHO_MARCA_PNG} — será combinada com a marca de texto.`);
} catch (err) {
  console.log(`[watermark] nenhum PNG de marca-d'água em ${CAMINHO_MARCA_PNG} — usando só a marca de texto (normal se você ainda não subiu o arquivo).`);
}

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * PRNG determinístico simples (mulberry32) a partir de uma seed textual.
 * A mesma foto (mesmo seed) sempre gera o mesmo padrão — mas cada foto
 * diferente tem posições/rotações diferentes, evitando um template único
 * de remoção em lote para todo o evento.
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
 * Redimensiona o PNG da marca e aplica opacidade (técnica padrão do Sharp:
 * "multiplica" o canal alpha existente usando blend "dest-in" com um tile
 * sólido do valor de opacidade desejado — preserva a transparência do
 * desenho original, só deixa tudo mais translúcido).
 */
async function prepararMarcaPng(larguraAlvo, opacidade) {
  return sharp(bufferMarcaPngOriginal)
    .resize({ width: Math.round(larguraAlvo), withoutEnlargement: true })
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([255, 255, 255, Math.round(255 * opacidade)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
}

/**
 * Monta as instâncias (posição/escala/opacidade/rotação) do PNG a compor
 * sobre a foto — mesma lógica de "espalhar por regiões diferentes" usada
 * nas marcas de texto, pra não deixar a logo restrita a um canto só.
 */
async function gerarCamadasMarcaPng(largura, altura, rand) {
  if (!bufferMarcaPngOriginal) return [];

  const instancias = [
    { larguraRel: 0.55, opacidade: 0.22, xRel: 0.5, yRel: 0.5 }, // instância grande central
    { larguraRel: 0.22, opacidade: 0.16 }, // secundárias, posição aleatória
    { larguraRel: 0.18, opacidade: 0.14 },
    { larguraRel: 0.16, opacidade: 0.13 },
  ];

  const camadas = [];
  for (const inst of instancias) {
    const larguraPng = Math.max(24, Math.floor(largura * inst.larguraRel));
    const bufferPng = await prepararMarcaPng(larguraPng, inst.opacidade);
    const meta = await sharp(bufferPng).metadata();

    const xRel = inst.xRel !== undefined ? inst.xRel : rand();
    const yRel = inst.yRel !== undefined ? inst.yRel : rand();
    const left = Math.min(Math.max(0, Math.round(largura * xRel - meta.width / 2)), largura - meta.width);
    const top = Math.min(Math.max(0, Math.round(altura * yRel - meta.height / 2)), altura - meta.height);

    camadas.push({ input: bufferPng, left, top, blend: 'over' });
  }
  return camadas;
}
function gerarMarcaPrincipal(largura, altura, rand) {
  const angulo = -30 + rand() * 14; // entre -30° e -16°
  const fonte = Math.max(30, Math.floor(largura / 6));
  const cx = largura / 2 + (rand() - 0.5) * largura * 0.12;
  const cy = altura / 2 + (rand() - 0.5) * altura * 0.12;

  let textos = '';
  for (let i = -2; i <= 2; i++) {
    const y = cy + i * fonte * 1.5;
    textos += `<text x="${cx}" y="${y}" font-size="${fonte}" font-family="Arial, sans-serif" font-weight="800"
      fill="white" fill-opacity="0.32" text-anchor="middle" transform="rotate(${angulo.toFixed(1)} ${cx} ${y})">${escaparXml(TEXTO_MARCA)}</text>`;
  }
  return textos;
}

/**
 * CAMADA 2 — marcas secundárias: várias, menores, espalhadas por outras
 * regiões da foto, cada uma com posição/rotação/escala/opacidade próprias
 * (não é um grid previsível).
 */
function gerarMarcasSecundarias(largura, altura, rand) {
  const QUANTIDADE = 13;
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
 * CAMADA 3 — textura de linhas finas em baixíssima opacidade, aplicada
 * depois com blend "overlay" (interage com o contraste/luminância dos
 * pixels da própria foto, em vez de ser só uma camada transparente por
 * cima — dificulta separar "camada da marca" de "camada da foto").
 */
function gerarTexturaInterativa(largura, altura, rand) {
  const espacamento = Math.max(10, Math.floor(largura / 70));
  const anguloBase = 45 + (rand() - 0.5) * 12;
  let linhas = '';
  for (let x = -altura; x < largura + altura; x += espacamento) {
    linhas += `<line x1="${x}" y1="0" x2="${x + altura}" y2="${altura}" stroke="white" stroke-opacity="0.09" stroke-width="1"/>`;
  }
  return `<svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(${anguloBase.toFixed(1)} ${largura / 2} ${altura / 2})">${linhas}</g>
  </svg>`;
}

/**
 * Linha pequena de aviso de direitos autorais — só informativa.
 */
function gerarRodapeDireitos(largura, altura) {
  const fonte = Math.max(10, Math.floor(largura / 95));
  return `<text x="${largura / 2}" y="${altura - fonte}" font-size="${fonte}" font-family="Arial, sans-serif"
    fill="white" fill-opacity="0.55" text-anchor="middle">${escaparXml(TEXTO_DIREITOS)}</text>`;
}

/**
 * @param {Buffer} bufferOriginal - buffer bruto do arquivo enviado
 * @param {string} [seed] - identificador único da foto (ex: o id gerado
 *   pra ela); garante que cada foto tenha um padrão de marca diferente.
 * @returns {Promise<Buffer>} buffer JPEG comprimido e com marca d'água
 */
async function comprimirEAplicarMarcaDagua(bufferOriginal, seed) {
  const imagem = sharp(bufferOriginal).rotate(); // .rotate() sem args = auto-orienta via EXIF
  const metadata = await imagem.metadata();

  const larguraFinal = Math.min(metadata.width || LARGURA_MAX, LARGURA_MAX);

  const redimensionada = imagem.resize({ width: larguraFinal, withoutEnlargement: true });
  const { data: bufferBase, info } = await redimensionada
    .clone()
    .jpeg({ quality: QUALIDADE })
    .toBuffer({ resolveWithObject: true });

  const rand = criarGeradorPseudoAleatorio(seed || crypto.randomUUID());
  const { width: w, height: h } = info;

  const svgTextos = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${gerarMarcasSecundarias(w, h, rand)}
    ${gerarMarcaPrincipal(w, h, rand)}
    ${gerarRodapeDireitos(w, h)}
  </svg>`;

  const svgTextura = gerarTexturaInterativa(w, h, rand);
  const camadasPng = await gerarCamadasMarcaPng(w, h, rand);

  const resultado = await sharp(bufferBase)
    .composite([
      { input: Buffer.from(svgTextura), blend: 'overlay' }, // camada 3: interage com os pixels
      ...camadasPng,                                        // camada extra: logo em PNG (se existir)
      { input: Buffer.from(svgTextos), blend: 'over' },     // camadas 1, 2 e rodapé: precisam ficar legíveis
    ])
    .jpeg({ quality: QUALIDADE, mozjpeg: true })
    .toBuffer();

  return resultado;
}

module.exports = { comprimirEAplicarMarcaDagua };
