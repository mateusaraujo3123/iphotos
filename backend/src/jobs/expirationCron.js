/**
 * Job agendado (item 4 do briefing): todo dia às 03h da manhã, varre os
 * eventos cujo prazo de 30 dias expirou e apaga permanentemente o registro
 * no banco + os binários (original e público) da nuvem correspondente.
 */
const cron = require('node-cron');
const prisma = require('../config/db');
const { excluirObjetos } = require('../config/storage');

async function excluirEventosExpirados() {
  const eventosExpirados = await prisma.evento.findMany({
    where: { expiraEm: { lt: new Date() } },
    include: { fotografo: true, fotos: true },
  });

  for (const evento of eventosExpirados) {
    try {
      const chavesPrivadas = evento.fotos.map((f) => f.chaveOriginal);
      const chavesPublicas = evento.fotos.map((f) => {
        const partes = f.urlPublica.split('/');
        const idx = partes.findIndex((p) => p === 'publico');
        return partes.slice(idx).join('/');
      });

      await excluirObjetos({
        provedorNuvem: evento.fotografo.provedorNuvem,
        chavesPrivadas,
        chavesPublicas,
      });

      await prisma.evento.delete({ where: { id: evento.id } });
      console.log(`[expiração] Evento ${evento.id} (${evento.titulo}) excluído com sucesso.`);
    } catch (err) {
      console.error(`[expiração] Falha ao excluir evento ${evento.id}:`, err);
    }
  }
}

function iniciarCronDeExpiracao() {
  // Roda todo dia às 03:00
  cron.schedule('0 3 * * *', excluirEventosExpirados);
  console.log('[cron] Job de expiração de eventos (30 dias) agendado para 03:00 diariamente.');
}

module.exports = { iniciarCronDeExpiracao, excluirEventosExpirados };
