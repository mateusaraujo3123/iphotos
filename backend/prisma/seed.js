/**
 * Popula a configuração inicial da plataforma (cor primária e taxa base).
 * Rode com: npm run seed
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.configuracaoPlataforma.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, taxaComissaoBase: 15.0, corPrimaria: '#00b4d8' },
  });
  console.log('Configuração inicial criada.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
