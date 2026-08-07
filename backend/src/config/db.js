const { PrismaClient } = require('@prisma/client');

// Evita múltiplas instâncias do Prisma Client em hot-reload (dev)
const globalParaPrisma = global;

const prisma = globalParaPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalParaPrisma.prisma = prisma;
}

module.exports = prisma;
