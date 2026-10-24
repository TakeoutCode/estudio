import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock, type IntegrationApp, signIn, startIntegrationApp } from '../../test/integration-app.js';
import { HEALTH_LIMITS, HealthMetrics } from './health-metrics.js';
import { HealthRepository } from './health.repository.js';

const HEALTH_TOKEN = 'token-de-salud-de-pruebas-de-al-menos-32';

describe('QA8: chequeos con las muestras en Postgres (ADR-018)', () => {
  let server: IntegrationApp;

  beforeAll(async () => {
    // Lejos de la hora de las demás pruebas, que comparten la base: sus muestras quedan fuera de
    // las ventanas de estos chequeos.
    server = await startIntegrationApp({ clock: new FakeClock(Date.UTC(2030, 0, 15, 12)) });
  });

  afterAll(async () => {
    await server.close();
  });

  const checks = async () => {
    const res = await server.api().get(`/health/checks/${HEALTH_TOKEN}`);
    return { status: res.status, body: res.body as unknown };
  };
  const stale = { status: 503, body: { status: 'failing', failing: ['cron_stale'] } };

  it('el tick que guarda el scheduler lo ve la función; sin señal en 15 min, cron_stale', async () => {
    expect(await checks()).toEqual(stale); // nunca corrió
    // Otra instancia de HealthMetrics, como la del daemon: no comparte memoria con la de la app.
    const scheduler = new HealthMetrics(server.app.get(HealthRepository));
    await scheduler.recordCronTick(server.clock.now());
    expect(await checks()).toEqual({ status: 200, body: { status: 'ok', failing: [] } });
    server.clock.advance(HEALTH_LIMITS.cronStaleMs + 1);
    expect(await checks()).toEqual(stale);
  });

  it('cada POST /sync/push deja su muestra antes de responder; un 4xx no cuenta como fallo', async () => {
    const { token } = await signIn(server, 'ella@ejemplo.mx');
    const since = new Date(server.clock.now());
    await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: '0192f1a0-0000-7000-8000-0000000000aa', mutations: [] })
      .expect(422);
    const rows = await server.prisma.$queryRaw<{ failed: boolean }[]>`
      SELECT "failed" FROM "health_sample" WHERE "kind" = 'sync_push' AND "at" >= ${since}`;
    expect(rows).toEqual([{ failed: false }]);
  });
});
