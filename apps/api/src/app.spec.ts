import { CONTRACT_HEADER, CONTRACT_VERSION, MIN_SAFE_CONTRACT, newId } from '@estudio/shared';
import { Controller, Get, Post, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { Public } from './modules/auth/public.js';
import { TokenService } from './modules/auth/token.service.js';
import { HealthRepository } from './modules/health/health.repository.js';
import { PrismaService } from './prisma/prisma.service.js';

const WEB = 'http://localhost:5180';
const HEALTH_TOKEN = 'token-de-salud-de-pruebas-de-al-menos-32';

// Pública para aislar contrato, CSRF y CORS; el access token se prueba en auth.int.spec.ts.
@Controller('probe')
@Public()
class ProbeController {
  @Get()
  read() {
    return { ok: true };
  }

  @Post()
  write() {
    return { ok: true };
  }

  /** La IP con la que cuenta el throttler (BE12). */
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

describe('app (integración HTTP, sin base)', () => {
  let app: NestExpressApplication;
  let tokens: TokenService;
  const ping = vi.fn<() => Promise<void>>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ProbeController] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(HealthRepository)
      .useValue({ ping })
      .compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
    await app.init();
    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ping.mockReset().mockResolvedValue(undefined);
  });

  it('GET /health responde sin cabecera de contrato', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('QA8: GET /health responde 503 problem+json si la base no contesta', async () => {
    ping.mockRejectedValue(new Error('connection refused'));
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'unavailable' });
  });

  it('QA8: GET /health/checks/:token solo con el token; 503 con los nombres de lo que falla', async () => {
    await request(app.getHttpServer()).get('/health/checks/otro-token-de-al-menos-32-caracteres').expect(404);
    await request(app.getHttpServer())
      .get(`/health/checks/${HEALTH_TOKEN}`)
      .expect(200, { status: 'ok', failing: [] });
    ping.mockRejectedValue(new Error('connection refused'));
    await request(app.getHttpServer())
      .get(`/health/checks/${HEALTH_TOKEN}`)
      .expect(503, { status: 'failing', failing: ['database'] });
  });

  it('FE13: POST /diagnostics/errors pide sesión y valida el lote', async () => {
    const report = {
      errors: [
        {
          id: newId(),
          message: 'TypeError: x is undefined',
          stack: null,
          route: '/study',
          appVersion: '19',
          occurredAt: Date.now(),
        },
      ],
    };
    const post = () =>
      request(app.getHttpServer()).post('/diagnostics/errors').set(CONTRACT_HEADER, String(CONTRACT_VERSION));
    await post().send(report).expect(401);
    const { token } = await tokens.issueAccess(newId());
    await post().set('Authorization', `Bearer ${token}`).send(report).expect(204);
    const invalid = await post()
      .set('Authorization', `Bearer ${token}`)
      .send({ errors: [{ ...report.errors[0], answer: 'el fémur' }] })
      .expect(422);
    expect(invalid.body).toMatchObject({ code: 'validation_failed' });
  });

  it('LD17: sin OPENAI_API_KEY, POST /ai/drafts responde 503 y la captura manual sigue', async () => {
    const { token } = await tokens.issueAccess(newId());
    const res = await request(app.getHttpServer())
      .post('/ai/drafts')
      .set(CONTRACT_HEADER, String(CONTRACT_VERSION))
      .set('Authorization', 'Bearer ' + token)
      .send({ sourceText: 'El deltoides está inervado por el nervio axilar.' })
      .expect(503);
    expect(res.body).toMatchObject({ code: 'unavailable' });
  });

  it('LD14: casos clínicos, distractores y la revisión de autoexplicaciones responden 503 sin IA, tras validar el pedido', async () => {
    const { token } = await tokens.issueAccess(newId());
    const post = (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set(CONTRACT_HEADER, String(CONTRACT_VERSION))
        .set('Authorization', 'Bearer ' + token);
    await post('/ai/clinical-cases').send({ sourceText: 'El deltoides lo inerva el axilar.' }).expect(503);
    const distractors = {
      question: '¿Qué nervio inerva el deltoides?',
      correct: 'Axilar',
      existing: [],
      context: null,
    };
    await post('/ai/distractors').send(distractors).expect(503);
    const invalid = await post('/ai/distractors')
      .send({ ...distractors, correct: '' })
      .expect(422);
    expect(invalid.body).toMatchObject({ code: 'validation_failed' });
    const explanation = {
      question: '¿Qué inerva el axilar?',
      key: 'El deltoides',
      explanation: 'El deltoides',
    };
    await post('/ai/explanation-check').send(explanation).expect(503);
    await post('/ai/explanation-check')
      .send({ ...explanation, explanation: '' })
      .expect(422);
  });

  it('ARC6: sin cabecera de contrato responde 426', async () => {
    const res = await request(app.getHttpServer()).get('/probe').expect(426);
    expect(res.body).toMatchObject({ code: 'contract_outdated' });
  });

  it('ARC6: un cliente anterior a MIN_SAFE_CONTRACT recibe 426 aunque MIN_CONTRACT sea menor', async () => {
    await request(app.getHttpServer())
      .get('/probe')
      .set(CONTRACT_HEADER, String(MIN_SAFE_CONTRACT - 1))
      .expect(426);
    await request(app.getHttpServer())
      .get('/probe')
      .set(CONTRACT_HEADER, String(MIN_SAFE_CONTRACT))
      .expect(200);
  });

  it('ARC6: con el contrato vigente deja pasar', async () => {
    await request(app.getHttpServer())
      .get('/probe')
      .set(CONTRACT_HEADER, String(CONTRACT_VERSION))
      .expect(200, { ok: true });
  });

  it('BE12: rechaza un POST de otro origen (CSRF) y acepta el de la web', async () => {
    const post = (origin: string) =>
      request(app.getHttpServer())
        .post('/probe')
        .set(CONTRACT_HEADER, String(CONTRACT_VERSION))
        .set('Origin', origin)
        .set('Sec-Fetch-Site', 'cross-site');
    const rejected = await post('https://malicioso.example').expect(403);
    expect(rejected.body).toMatchObject({ code: 'forbidden' });
    await post(WEB).expect(201);
  });

  it('BE12: CORS solo para la web', async () => {
    const preflight = (origin: string) =>
      request(app.getHttpServer())
        .options('/probe')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');
    expect((await preflight(WEB)).headers['access-control-allow-origin']).toBe(WEB);
    expect(
      (await preflight('https://malicioso.example')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('SY8: CORS expone Retry-After, para que la web espere lo que pide el servidor', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('Origin', WEB);
    expect(res.headers['access-control-expose-headers']?.split(',')).toContain('retry-after');
  });

  it('BE12: detrás del proxy (TRUST_PROXY_HOPS=1) cuenta la IP que agrega él, no la que dice el cliente', async () => {
    const ip = async (forwarded: string) =>
      (
        await request(app.getHttpServer())
          .get('/probe/ip')
          .set(CONTRACT_HEADER, String(CONTRACT_VERSION))
          .set('X-Forwarded-For', forwarded)
          .expect(200)
      ).body as { ip: string };
    expect(await ip('203.0.113.7')).toEqual({ ip: '203.0.113.7' });
    // Lo que el cliente escribe a la izquierda no cambia su IP: el proxy agrega la real al final.
    expect(await ip('198.51.100.1, 203.0.113.7')).toEqual({ ip: '203.0.113.7' });
  });

  it('BE12: cabeceras de seguridad, request id y sin X-Powered-By', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('x-request-id', 'abc-123');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('BE5: una ruta desconocida responde 404 problem+json', async () => {
    const res = await request(app.getHttpServer()).get('/no-existe').expect(404);
    expect(res.body).toMatchObject({ code: 'not_found', status: 404 });
  });
});
