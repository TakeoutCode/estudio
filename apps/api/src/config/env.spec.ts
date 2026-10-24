import { describe, expect, it } from 'vitest';
import { EnvSchema } from './env.js';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.neon.tech/estudio?sslmode=require',
  DIRECT_DATABASE_URL: 'postgresql://u:p@db.neon.tech/estudio?sslmode=require',
  WEB_ORIGINS: 'https://app.ejemplo.mx',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  ALLOWED_EMAILS: 'ella@ejemplo.mx',
  VAPID_PUBLIC_KEY: 'BPublica',
  VAPID_PRIVATE_KEY: 'privada',
  VAPID_SUBJECT: 'mailto:avisos@ejemplo.mx',
  CLOUDINARY_URL: 'cloudinary://123456789012345:secreto@estudio-demo',
  HEALTH_CHECK_TOKEN: 't'.repeat(40),
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

  it.each(['DATABASE_URL', 'DIRECT_DATABASE_URL', 'WEB_ORIGINS', 'JWT_ACCESS_SECRET', 'ALLOWED_EMAILS'])(
    'falla si falta %s',
    (key) => {
      const env = Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));
      expect(EnvSchema.safeParse(env).success).toBe(false);
    },
  );

  it('ADR-018: sin NODE_ENV (en Vercel no se carga) vale production, con todo lo que exige', () => {
    const without = (...keys: string[]) =>
      Object.fromEntries(Object.entries(base).filter(([k]) => !keys.includes(k)));
    expect(EnvSchema.parse(without('NODE_ENV')).NODE_ENV).toBe('production');
    expect(EnvSchema.safeParse(without('NODE_ENV', 'VAPID_PRIVATE_KEY')).success).toBe(false);
  });

  it.each(['https://app.ejemplo.mx/', 'https://app.ejemplo.mx/login', 'ftp://app.ejemplo.mx', ''])(
    'rechaza el origen %j (CORS y CSRF exigen scheme://host[:port])',
    (origin) => {
      expect(EnvSchema.safeParse({ ...base, WEB_ORIGINS: origin }).success).toBe(false);
    },
  );

  it('NT8: en producción exige las claves VAPID; fuera de ella son opcionales', () => {
    const without = { ...base, VAPID_PRIVATE_KEY: undefined };
    expect(EnvSchema.safeParse(without).success).toBe(false);
    expect(EnvSchema.safeParse({ ...without, NODE_ENV: 'development' }).success).toBe(true);
    expect(EnvSchema.safeParse({ ...base, NODE_ENV: 'development', VAPID_PUBLIC_KEY: '' }).success).toBe(
      true,
    );
    expect(EnvSchema.safeParse({ ...base, VAPID_SUBJECT: 'avisos@ejemplo.mx' }).success).toBe(false);
  });

  it('ADR-010: en producción exige CLOUDINARY_URL con clave, secreto y nube; fuera de ella es opcional', () => {
    const without = { ...base, CLOUDINARY_URL: undefined };
    expect(EnvSchema.safeParse(without).success).toBe(false);
    expect(EnvSchema.safeParse({ ...without, NODE_ENV: 'development' }).success).toBe(true);
    expect(EnvSchema.safeParse({ ...base, NODE_ENV: 'test', CLOUDINARY_URL: '' }).success).toBe(true);
    for (const url of [
      'https://api.cloudinary.com',
      'cloudinary://clave@nube',
      'cloudinary://clave:secreto@',
    ]) {
      expect(EnvSchema.safeParse({ ...base, CLOUDINARY_URL: url }).success).toBe(false);
    }
  });

  it('QA8: en producción exige HEALTH_CHECK_TOKEN de 32 caracteres; fuera de ella es opcional', () => {
    const without = { ...base, HEALTH_CHECK_TOKEN: undefined };
    expect(EnvSchema.safeParse(without).success).toBe(false);
    expect(EnvSchema.safeParse({ ...without, NODE_ENV: 'development' }).success).toBe(true);
    expect(EnvSchema.safeParse({ ...base, NODE_ENV: 'test', HEALTH_CHECK_TOKEN: '' }).success).toBe(true);
    expect(EnvSchema.safeParse({ ...base, HEALTH_CHECK_TOKEN: 'corto' }).success).toBe(false);
  });

  it('LD17: la IA es opcional; clave y modelo van juntos y la cuota tiene valores iniciales', () => {
    const parsed = EnvSchema.parse(base);
    expect(parsed).toMatchObject({ AI_DAILY_REQUESTS: 30, AI_DAILY_TOKENS: 200_000 });
    expect(parsed.OPENAI_API_KEY).toBeUndefined();
    expect(EnvSchema.safeParse({ ...base, OPENAI_API_KEY: 'sk-x', OPENAI_MODEL: 'modelo' }).success).toBe(
      true,
    );
    expect(EnvSchema.safeParse({ ...base, OPENAI_API_KEY: 'sk-x' }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...base, OPENAI_MODEL: 'modelo' }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...base, AI_DAILY_REQUESTS: '0' }).success).toBe(false);
  });

  it('rechaza una URL de base que no es Postgres', () => {
    expect(EnvSchema.safeParse({ ...base, DATABASE_URL: 'mysql://u:p@h/db' }).success).toBe(false);
  });
});
