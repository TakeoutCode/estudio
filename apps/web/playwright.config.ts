import { defineConfig, devices } from '@playwright/test';
import { accountFor, E2E_API, E2E_PROJECTS } from './e2e/accounts';

// QUALITY §1 y QA4 (paso 6): flujos completos en un iPhone (WebKit) y en escritorio (Chromium),
// contra la API real con su Postgres. La base la pone quien corre las pruebas: en CI un servicio
// de GitHub Actions; en local, por ejemplo,
//   docker run -d --rm -p 5444:5432 -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e postgres:17-alpine
//   E2E_DATABASE_URL=postgresql://e2e:e2e@localhost:5444/e2e pnpm --filter @estudio/web test:e2e
// Puertos propios (4180 y 3190) para no chocar con `pnpm dev` (5180 y 3180).

const WEB = 'http://localhost:4180';
const API = E2E_API;
const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://e2e:e2e@localhost:5444/e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Un solo worker: las pruebas comparten la base y la sesión de cada proyecto.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // La API de verdad: migraciones desde cero y el build de producción.
      command:
        'pnpm --dir ../api exec prisma migrate deploy && pnpm --dir ../api build && node ../api/dist/main.js',
      url: `${API}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        PORT: '3190',
        LOG_LEVEL: 'warn',
        DATABASE_URL: databaseUrl,
        DIRECT_DATABASE_URL: databaseUrl,
        JWT_ACCESS_SECRET: 'secreto-de-pruebas-e2e-de-al-menos-32-caracteres',
        WEB_ORIGINS: WEB,
        // Como en Vercel (BE12): la IP del cliente sale de X-Forwarded-For. Cada "dispositivo" de
        // las pruebas manda la suya (e2e/fixtures.ts), así el límite de login no las cruza.
        TRUST_PROXY_HOPS: '1',
        ALLOWED_EMAILS: E2E_PROJECTS.map(accountFor).join(','),
      },
    },
    {
      // La PWA como se publica (FE6): build y vista previa, con la API de arriba.
      command: 'vite build --manifest && vite preview --port 4180 --strictPort',
      url: WEB,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_URL: `${API}/api` },
    },
  ],
});
