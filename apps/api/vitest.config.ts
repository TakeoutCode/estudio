import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest necesita la metadata de decoradores, que solo emite SWC (ADR-014).
// QUALITY §1: `unit` no toca la base; `integration` levanta Postgres 17 con Testcontainers.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    setupFiles: ['reflect-metadata'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://test:test@localhost:5433/test',
      DIRECT_DATABASE_URL: 'postgresql://test:test@localhost:5433/test',
      WEB_ORIGINS: 'http://localhost:5180',
      JWT_ACCESS_SECRET: 'secreto-de-pruebas-de-al-menos-32-caracteres',
      ALLOWED_EMAILS:
        'ella@ejemplo.mx,otra@ejemplo.mx,sync-a@ejemplo.mx,sync-b@ejemplo.mx,sync-c@ejemplo.mx,sync-d@ejemplo.mx,sync-e@ejemplo.mx,temporizador@ejemplo.mx',
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'], exclude: ['src/**/*.int.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.spec.ts'],
          globalSetup: ['src/test/postgres.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
