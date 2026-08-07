const prisma = require('../config/db');

/**
 * GET /api/eventos
 * Lista pública usada pelo index.html (cards filtráveis por categoria/busca).
 * Somente eventos ainda não expirados são retornados.
 */
async function listarEventos(req, res) {
  const { categoria, busca } = req.query;

  const eventos = await prisma.evento.findMany({
    where: {
      expiraEm: { gt: new Date() },
      ...(categoria && categoria !== 'todos' ? { categoria } : {}),
      ...(busca
        ? {
            OR: [
              { titulo: { contains: busca, mode: 'insensitive' } },
              { local: { contains: busca, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { dataRealizacao: 'desc' },
    select: {
      id: true,
      titulo: true,
      categoria: true,
      local: true,
      dataRealizacao: true,
      fotoCapaUrl: true,
      _count: { select: { fotos: true } },
    },
  });

  res.json(eventos);
}

/**
 * GET /api/eventos/:id
 * Usada pelo evento.html — retorna o mural de fotos PÚBLICAS (comprimidas + marca d'água).
 * O arquivo original nunca é exposto aqui.
 */
async function detalharEvento(req, res) {
  const { id } = req.params;

  const evento = await prisma.evento.findUnique({
    where: { id },
    include: {
      fotografo: { select: { id: true, nome: true } },
      fotos: {
        select: { id: true, urlPublica: true, preco: true },
        orderBy: { criadoEm: 'asc' },
      },
    },
  });

  if (!evento || evento.expiraEm < new Date()) {
    return res.status(404).json({ erro: 'Evento não encontrado ou expirado.' });
  }

  res.json(evento);
}

module.exports = { listarEventos, detalharEvento };
