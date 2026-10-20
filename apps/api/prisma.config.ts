// Configuración de la CLI de Prisma 7. La app no usa este archivo: se conecta con el
// adaptador `pg` y `DATABASE_URL` (pooler). Las migraciones usan la URL directa.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Una URL ya definida (CI, Testcontainers, Railway) manda sobre el .env local.
if (!process.env.DIRECT_DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

const directUrl = process.env.DIRECT_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` (CI, build) no necesita base; migrate sí y falla claro si falta.
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
