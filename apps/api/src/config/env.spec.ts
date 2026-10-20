import { describe, expect, it } from 'vitest';
import { EnvSchema } from './env.js';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.neon.tech/estudio?sslmode=require',
  DIRECT_DATABASE_URL: 'postgresql://u:p@db.neon.tech/estudio?sslmode=require',
  WEB_ORIGINS: 'https://app.ejemplo.mx',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  ALLOWED_EMAILS: 'ella@ejemplo.mx',
};

describe('EnvSchema (BACKEND BE4)', () => {
  it('aplica valores por defecto y separa los orígenes', () => {
    const env = EnvSchema.parse({ ...base, WEB_ORIGINS: 'https://app.ejemplo.mx, http://localhost:5173' });
    expect(env).toMatchObject({ PORT: 3000, LOG_LEVEL: 'info', MIN_CONTRACT: 1 });
    expect(env.WEB_ORIGINS).toEqual(['https://app.ejemplo.mx', 'http://localhost:5173']);
  });

  it('BE10: exige un secreto JWT de 32 caracteres y normaliza la lista de correos', () => {
    expect(EnvSchema.safeParse({ ...base, JWT_ACCESS_SECRET: 'corto' }).success).toBe(false);
    expect(EnvSchema.parse({ ...base, ALLOWED_EMAILS: ' Ella@Ejemplo.MX , b@c.mx' }).ALLOWED_EMAILS).toEqual([
      'ella@ejemplo.mx',
      'b@c.mx',
    ]);
    expect(EnvSchema.safeParse({ ...base, ALLOWED_EMAILS: 'no-es-correo' }).success).toBe(false);
  });

  it.each([
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    'WEB_ORIGINS',
    'NODE_ENV',
    'JWT_ACCESS_SECRET',
    'ALLOWED_EMAILS',
  ])('falla si falta %s', (key) => {
    const env = Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));
    expect(EnvSchema.safeParse(env).success).toBe(false);
  });

  it.each(['https://app.ejemplo.mx/', 'https://app.ejemplo.mx/login', 'ftp://app.ejemplo.mx', ''])(
    'rechaza el origen %j (CORS y CSRF exigen scheme://host[:port])',
    (origin) => {
      expect(EnvSchema.safeParse({ ...base, WEB_ORIGINS: origin }).success).toBe(false);
    },
  );

  it('rechaza una URL de base que no es Postgres', () => {
    expect(EnvSchema.safeParse({ ...base, DATABASE_URL: 'mysql://u:p@h/db' }).success).toBe(false);
  });
});
