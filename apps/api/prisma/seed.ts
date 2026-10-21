// Seeder de desarrollo (`pnpm db:seed`): carga el mazo de huesos en una cuenta ya registrada,
// la de SEED_EMAIL o, si no está, el primer correo de ALLOWED_EMAILS. Lo corre la CLI de
// Prisma (`migrations.seed` en prisma.config.ts) y, como ese archivo, lee el entorno directo.
import { existsSync } from 'node:fs';
import { EmailSchema } from '@estudio/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { BONES_DECK } from '../src/seed/bones-deck.js';
import { seedBonesDeck } from '../src/seed/seed-bones-deck.js';

if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

const { DATABASE_URL, NODE_ENV, SEED_EMAIL, ALLOWED_EMAILS } = process.env;

// LD16: el contenido del mazo no pasó por su revisión; en producción no se carga solo.
if (NODE_ENV === 'production') throw new Error('El seeder es solo para desarrollo (LD16).');
if (!DATABASE_URL) throw new Error('Falta DATABASE_URL: copia .env.example a .env.');

const email = EmailSchema.parse(SEED_EMAIL ?? ALLOWED_EMAILS?.split(',')[0] ?? '');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error(`No hay una cuenta con ${email}. Regístrate primero en la app con ese correo.`);
    process.exitCode = 1;
  } else {
    const result = await seedBonesDeck(prisma, { userId: user.id, now: Date.now() });
    console.log(
      result.status === 'created'
        ? `«${BONES_DECK.name}» creado para ${email}: ${result.topics} temas, ${result.notes} notas y ${result.cards} tarjetas.`
        : `${email} ya tiene «${BONES_DECK.name}»; no se cambió nada. Bórralo en la app para volver a crearlo.`,
    );
  }
} finally {
  await prisma.$disconnect();
}
