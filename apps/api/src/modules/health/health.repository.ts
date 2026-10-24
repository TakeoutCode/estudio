import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { HealthSnapshot } from './health-metrics.js';

export type HealthSampleKind = 'sync_push' | 'push_delivery' | 'cron_tick' | 'ai_budget';

export interface NewHealthSample {
  readonly kind: HealthSampleKind;
  readonly at: number;
  readonly ms?: number;
  readonly failed?: boolean;
  readonly share?: number;
}

/**
 * Usa el cliente directo y no `txHost`: una muestra se guarda aunque la transacción del
 * request que la produjo se deshaga.
 */
@Injectable()
export class HealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async insertSample(sample: NewHealthSample): Promise<void> {
    await this.prisma.healthSample.create({ data: { ...sample, at: new Date(sample.at) } });
  }

  async pruneSamples(before: number): Promise<void> {
    await this.prisma.healthSample.deleteMany({ where: { at: { lt: new Date(before) } } });
  }

  /** Pushes desde `pushesSince`, envíos desde `deliveriesSince` y la última señal de cron e IA. */
  async snapshot(pushesSince: number, deliveriesSince: number): Promise<HealthSnapshot> {
    const [pushes, deliveries, tick, ai] = await Promise.all([
      this.prisma.healthSample.findMany({
        where: { kind: 'sync_push', at: { gt: new Date(pushesSince) } },
        select: { at: true, ms: true, failed: true },
      }),
      this.prisma.healthSample.findMany({
        where: { kind: 'push_delivery', at: { gt: new Date(deliveriesSince) } },
        select: { at: true, failed: true },
      }),
      this.latest('cron_tick'),
      this.latest('ai_budget'),
    ]);
    return {
      pushes: pushes.map((p) => ({ at: p.at.getTime(), ms: p.ms ?? 0, failed: p.failed ?? false })),
      deliveries: deliveries.map((d) => ({ at: d.at.getTime(), gone: d.failed ?? false })),
      lastCronTick: tick?.at.getTime() ?? null,
      aiBudget: ai ? { at: ai.at.getTime(), share: ai.share ?? 0 } : null,
    };
  }

  private latest(kind: HealthSampleKind) {
    return this.prisma.healthSample.findFirst({
      where: { kind },
      orderBy: { at: 'desc' },
      select: { at: true, share: true },
    });
  }
}
