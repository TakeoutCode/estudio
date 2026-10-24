import type { HealthSnapshot } from '../modules/health/health-metrics.js';
import type {
  HealthRepository,
  HealthSampleKind,
  NewHealthSample,
} from '../modules/health/health.repository.js';

/** `HealthRepository` en memoria para las pruebas unitarias (QA8), con la misma lectura. */
export class FakeHealthRepository implements Pick<
  HealthRepository,
  'ping' | 'insertSample' | 'pruneSamples' | 'snapshot'
> {
  samples: NewHealthSample[] = [];

  ping(): Promise<void> {
    return Promise.resolve();
  }

  insertSample(sample: NewHealthSample): Promise<void> {
    this.samples.push(sample);
    return Promise.resolve();
  }

  pruneSamples(before: number): Promise<void> {
    this.samples = this.samples.filter((s) => s.at >= before);
    return Promise.resolve();
  }

  snapshot(pushesSince: number, deliveriesSince: number): Promise<HealthSnapshot> {
    const of = (kind: HealthSampleKind) => this.samples.filter((s) => s.kind === kind);
    const latest = (kind: HealthSampleKind) =>
      of(kind).reduce<NewHealthSample | null>((a, s) => (a && a.at >= s.at ? a : s), null);
    const ai = latest('ai_budget');
    return Promise.resolve({
      pushes: of('sync_push')
        .filter((s) => s.at > pushesSince)
        .map((s) => ({ at: s.at, ms: s.ms ?? 0, failed: s.failed ?? false })),
      deliveries: of('push_delivery')
        .filter((s) => s.at > deliveriesSince)
        .map((s) => ({ at: s.at, gone: s.failed ?? false })),
      lastCronTick: latest('cron_tick')?.at ?? null,
      aiBudget: ai ? { at: ai.at, share: ai.share ?? 0 } : null,
    });
  }

  /** Para pasarlo donde se espera el repositorio real. */
  asRepository(): HealthRepository {
    return this as unknown as HealthRepository;
  }
}
