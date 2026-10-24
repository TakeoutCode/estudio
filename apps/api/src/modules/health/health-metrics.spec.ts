import { describe, expect, it, vi } from 'vitest';
import { FakeHealthRepository } from '../../test/fake-health-repository.js';
import {
  failingChecks,
  HEALTH_LIMITS,
  HealthMetrics,
  type HealthSnapshot,
  type PushSample,
} from './health-metrics.js';

const T0 = Date.UTC(2026, 9, 21, 12);
const MIN = 60_000;

const snapshot = (overrides: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  pushes: [],
  deliveries: [],
  lastCronTick: T0,
  aiBudget: null,
  ...overrides,
});

/** `count` pushes de sync en la última hora, `failed` de ellos con error del servidor. */
const pushes = (count: number, { failed = 0, ms = 100 } = {}): PushSample[] =>
  Array.from({ length: count }, (_, i) => ({ at: T0 + i * 1000, ms, failed: i < failed }));

describe('QA8: chequeos de salud', () => {
  it('con el cron al día y sin muestras, nada falla', () => {
    expect(failingChecks(snapshot(), T0 + 5 * MIN)).toEqual([]);
  });

  it('más del 5 % de los push de sync fallan en una hora', () => {
    const at = T0 + MIN;
    expect(failingChecks(snapshot({ pushes: pushes(40, { failed: 2 }), lastCronTick: at }), at)).toEqual([]); // 5 %: todavía no
    const bad = pushes(40, { failed: 3 });
    expect(failingChecks(snapshot({ pushes: bad, lastCronTick: at }), at)).toEqual(['sync_push_errors']);
    // Pasada la hora, esos fallos ya no cuentan.
    const later = T0 + HEALTH_LIMITS.windowMs + 2 * MIN;
    expect(failingChecks(snapshot({ pushes: bad, lastCronTick: later }), later)).toEqual([]);
  });

  it('con pocas muestras un fallo suelto no alarma', () => {
    const few = pushes(HEALTH_LIMITS.syncPushMinSamples - 1, { failed: 5, ms: 5000 });
    expect(failingChecks(snapshot({ pushes: few }), T0 + MIN)).toEqual([]);
  });

  it('el p95 de /sync/push supera 1 s', () => {
    const slow = { ms: 1500, failed: false };
    const twoSlow = [...pushes(18, { ms: 200 }), { at: T0 + 30_000, ...slow }, { at: T0 + 31_000, ...slow }];
    expect(failingChecks(snapshot({ pushes: twoSlow }), T0 + MIN)).toEqual(['sync_push_slow']); // 2 de 20: el p95 es 1500
    const oneSlow = [...pushes(19, { ms: 200 }), { at: T0 + 30_000, ...slow }];
    expect(failingChecks(snapshot({ pushes: oneSlow }), T0 + MIN)).toEqual([]); // 1 de 20: el p95 es 200
  });

  it('el cron no corre en 15 min, o nunca corrió', () => {
    expect(failingChecks(snapshot(), T0 + HEALTH_LIMITS.cronStaleMs)).toEqual([]);
    expect(failingChecks(snapshot(), T0 + HEALTH_LIMITS.cronStaleMs + 1)).toEqual(['cron_stale']);
    expect(failingChecks(snapshot({ lastCronTick: null }), T0)).toEqual(['cron_stale']);
  });

  it('la tasa de 410 en Web Push supera el 20 %', () => {
    const tenWithTwoGone = Array.from({ length: 10 }, (_, i) => ({ at: T0 + i, gone: i < 2 }));
    expect(failingChecks(snapshot({ deliveries: tenWithTwoGone }), T0 + MIN)).toEqual([]); // 20 %: todavía no
    const deliveries = [...tenWithTwoGone, { at: T0 + 20, gone: true }];
    expect(failingChecks(snapshot({ deliveries }), T0 + MIN)).toEqual(['web_push_gone']);
  });

  it('el gasto de IA del día pasa del 80 % de la cuota (y una medición vieja no cuenta)', () => {
    expect(failingChecks(snapshot({ aiBudget: { at: T0, share: 0.8 } }), T0 + MIN)).toEqual([]);
    expect(failingChecks(snapshot({ aiBudget: { at: T0 + MIN, share: 0.81 } }), T0 + 2 * MIN)).toEqual([
      'ai_budget',
    ]);
    const later = T0 + HEALTH_LIMITS.aiBudgetMaxAgeMs + 2 * MIN;
    expect(
      failingChecks(snapshot({ aiBudget: { at: T0 + MIN, share: 0.81 }, lastCronTick: later }), later),
    ).toEqual([]);
  });
});

describe('QA8: HealthMetrics guarda las muestras fuera del proceso (ADR-018)', () => {
  it('lo que registra un proceso lo lee otro, y el tick del cron purga lo de más de 24 h', async () => {
    const repo = new FakeHealthRepository();
    const writer = new HealthMetrics(repo.asRepository());
    const reader = new HealthMetrics(repo.asRepository());
    await writer.recordAiBudget(T0, 0.9);
    await writer.recordCronTick(T0);
    expect(await reader.failing(T0 + MIN)).toEqual(['ai_budget']);
    await writer.recordCronTick(T0 + HEALTH_LIMITS.retentionMs + MIN);
    expect(repo.samples.map((s) => s.kind)).toEqual(['cron_tick']);
  });

  it('una muestra que no se puede guardar no rompe lo que se estaba midiendo', async () => {
    const repo = new FakeHealthRepository();
    vi.spyOn(repo, 'insertSample').mockRejectedValue(new Error('connection refused'));
    await expect(
      new HealthMetrics(repo.asRepository()).recordSyncPush(T0, 100, false),
    ).resolves.toBeUndefined();
  });
});
