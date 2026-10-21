import { describe, expect, it } from 'vitest';
import { HEALTH_LIMITS, HealthMetrics } from './health-metrics.js';

const T0 = Date.UTC(2026, 9, 21, 12);
const MIN = 60_000;

const metrics = () => new HealthMetrics({ now: () => T0 });

/** `count` pushes de sync en la última hora, `failed` de ellos con error del servidor. */
const pushes = (m: HealthMetrics, count: number, { failed = 0, ms = 100 } = {}) => {
  for (let i = 0; i < count; i += 1) m.recordSyncPush(T0 + i * 1000, ms, i < failed);
};

describe('QA8: chequeos de salud', () => {
  it('recién arrancada y con el cron al día, nada falla', () => {
    const m = metrics();
    m.recordCronTick(T0);
    expect(m.failing(T0 + 5 * MIN)).toEqual([]);
  });

  it('más del 5 % de los push de sync fallan en una hora', () => {
    const fine = metrics();
    pushes(fine, 40, { failed: 2 }); // 5 %: todavía no
    fine.recordCronTick(T0 + 40_000);
    expect(fine.failing(T0 + MIN)).toEqual([]);
    const bad = metrics();
    pushes(bad, 40, { failed: 3 });
    bad.recordCronTick(T0 + 40_000);
    expect(bad.failing(T0 + MIN)).toEqual(['sync_push_errors']);
    // Pasada la hora, esos fallos ya no cuentan.
    bad.recordCronTick(T0 + HEALTH_LIMITS.windowMs + MIN);
    expect(bad.failing(T0 + HEALTH_LIMITS.windowMs + 2 * MIN)).toEqual([]);
  });

  it('con pocas muestras un fallo suelto no alarma', () => {
    const m = metrics();
    pushes(m, HEALTH_LIMITS.syncPushMinSamples - 1, { failed: 5, ms: 5000 });
    m.recordCronTick(T0);
    expect(m.failing(T0 + MIN)).toEqual([]);
  });

  it('el p95 de /sync/push supera 1 s', () => {
    const m = metrics();
    pushes(m, 18, { ms: 200 });
    m.recordSyncPush(T0 + 30_000, 1500, false);
    m.recordSyncPush(T0 + 31_000, 1500, false);
    m.recordCronTick(T0);
    expect(m.failing(T0 + MIN)).toEqual(['sync_push_slow']); // 2 de 20 lentos: el p95 es 1500
    const ok = metrics();
    pushes(ok, 19, { ms: 200 });
    ok.recordSyncPush(T0 + 30_000, 1500, false);
    ok.recordCronTick(T0);
    expect(ok.failing(T0 + MIN)).toEqual([]); // 1 de 20: el p95 es 200
  });

  it('el cron no corre en 15 min (contando desde el arranque)', () => {
    const m = metrics();
    expect(m.failing(T0 + HEALTH_LIMITS.cronStaleMs)).toEqual([]);
    expect(m.failing(T0 + HEALTH_LIMITS.cronStaleMs + 1)).toEqual(['cron_stale']);
    m.recordCronTick(T0 + 20 * MIN);
    expect(m.failing(T0 + 21 * MIN)).toEqual([]);
  });

  it('la tasa de 410 en Web Push supera el 20 %', () => {
    const m = metrics();
    m.recordCronTick(T0);
    for (let i = 0; i < 10; i += 1) m.recordPushDelivery(T0 + i, i < 2);
    expect(m.failing(T0 + MIN)).toEqual([]); // 20 %: todavía no
    m.recordPushDelivery(T0 + 20, true);
    expect(m.failing(T0 + MIN)).toEqual(['web_push_gone']);
  });
});
