import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * QUALITY §1: un Postgres 17 desechable por corrida, con las migraciones reales aplicadas
 * por `prisma migrate deploy` (lo mismo que corre en producción).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DIRECT_DATABASE_URL: url },
    stdio: 'pipe',
  });
  project.provide('databaseUrl', url);
  return async () => {
    await container.stop();
  };
}
