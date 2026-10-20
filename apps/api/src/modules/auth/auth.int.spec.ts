import { SessionResponseSchema } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type IntegrationApp,
  PASSWORD,
  refreshCookie,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';
import { ACCESS_TTL_MS, REFRESH_REUSE_GRACE_MS } from './constants.js';

const EMAIL = 'ella@ejemplo.mx';

describe('auth (BACKEND BE10, BE11) contra Postgres real', () => {
  let server: IntegrationApp;

  beforeAll(async () => {
    server = await startIntegrationApp();
  });

  afterAll(async () => {
    await server.close();
  });

  it('registro permitido + login: access token y cookie HttpOnly, SameSite=Lax, Path=/auth', async () => {
    await server.api().post('/auth/register').send({ email: EMAIL, password: PASSWORD }).expect(202);
    const res = await server.api().post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);

    expect(SessionResponseSchema.safeParse(res.body).success).toBe(true);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/estudio_rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(res.headers['cache-control']).toBe('no-store');

    const hash = await server.prisma.$queryRaw<{ password_hash: string }[]>`
      SELECT "password_hash" FROM "user" WHERE "email" = ${EMAIL}`;
    expect(hash[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
  });

  it('ADR-007: un correo fuera de la lista recibe la misma respuesta y no puede entrar', async () => {
    const email = 'intruso@ejemplo.mx';
    await server.api().post('/auth/register').send({ email, password: PASSWORD }).expect(202);
    const res = await server.api().post('/auth/login').send({ email, password: PASSWORD }).expect(401);
    expect(res.body).toMatchObject({ code: 'unauthorized' });
  });

  it('volver a registrar un correo existente no cambia su contraseña', async () => {
    await server
      .api()
      .post('/auth/register')
      .send({ email: EMAIL, password: 'otra-contraseña-distinta' })
      .expect(202);
    await server
      .api()
      .post('/auth/login')
      .send({ email: EMAIL, password: 'otra-contraseña-distinta' })
      .expect(401);
    await server.api().post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
  });

  it('BE11: sin token o con token vencido responde 401', async () => {
    const { token } = await signIn(server, EMAIL);
    await server.api().get('/sync/pull').expect(401);
    await server.api().get('/sync/pull').set('Authorization', `Bearer ${token}`).expect(200);
    server.clock.advance(ACCESS_TTL_MS + 1000);
    await server.api().get('/sync/pull').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('refresh rota el token; reusar el viejo fuera de la gracia revoca toda la familia', async () => {
    const { cookie: first } = await signIn(server, EMAIL);
    const rotated = await server.api().post('/auth/refresh').set('Cookie', first).expect(200);
    const second = refreshCookie(rotated);
    expect(second).not.toBe(first);

    server.clock.advance(REFRESH_REUSE_GRACE_MS + 1000);
    await server.api().post('/auth/refresh').set('Cookie', first).expect(401);
    // La familia quedó revocada: tampoco sirve el token nuevo.
    await server.api().post('/auth/refresh').set('Cookie', second).expect(401);
  });

  it('dos pestañas que refrescan a la vez: la segunda recibe 409 y la sesión sigue viva', async () => {
    const { cookie } = await signIn(server, EMAIL);
    const winner = await server.api().post('/auth/refresh').set('Cookie', cookie).expect(200);
    const loser = await server.api().post('/auth/refresh').set('Cookie', cookie).expect(409);
    expect(loser.body).toMatchObject({ code: 'conflict' });
    await server.api().post('/auth/refresh').set('Cookie', refreshCookie(winner)).expect(200);
  });

  it('logout revoca la sesión de ese dispositivo', async () => {
    const { cookie } = await signIn(server, EMAIL);
    await server.api().post('/auth/logout').set('Cookie', cookie).expect(204);
    await server.api().post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('refresh sin cookie responde 401', async () => {
    await server.api().post('/auth/refresh').expect(401);
  });
});

describe('límite de login (BE12)', () => {
  let server: IntegrationApp;

  beforeAll(async () => {
    server = await startIntegrationApp({ throttle: true });
  });

  afterAll(async () => {
    await server.close();
  });

  it('el sexto intento en un minuto responde 429', async () => {
    const attempt = () =>
      server.api().post('/auth/login').send({ email: 'otra@ejemplo.mx', password: 'contraseña-incorrecta' });
    for (let i = 0; i < 5; i += 1) await attempt().expect(401);
    const blocked = await attempt().expect(429);
    expect(blocked.body).toMatchObject({ code: 'rate_limited' });
  });
});
