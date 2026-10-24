import type { HealthCheckName } from '@estudio/shared';
import { Injectable, Logger } from '@nestjs/common';
import { HealthRepository } from './health.repository.js';

/**
 * QUALITY QA8: cuándo falla cada chequeo. Son parámetros de operación, no umbrales de estudio
 * (AGENTS AG4 no aplica): los de QA8 tal cual, más mínimos de muestra para que con una sola
 * usuaria un fallo suelto no dispare la alerta.
 */
export const HEALTH_LIMITS = {
  /** QA8: "en una hora". */
  windowMs: 60 * 60_000,
  syncPushFailureShare: 0.05,
  syncPushP95Ms: 1000,
  syncPushMinSamples: 20,
  cronStaleMs: 15 * 60_000,
  webPushGoneShare: 0.2,
  /** Los avisos son pocos al día: la tasa de 410 se mira en 24 h. */
  webPushWindowMs: 24 * 60 * 60_000,
  webPushMinSamples: 5,
  /** QA8: el gasto de IA del día pasa del 80 % de la cuota. */
  aiBudgetShare: 0.8,
  /** Una medición de más de un día ya no dice nada del día de hoy. */
  aiBudgetMaxAgeMs: 24 * 60 * 60_000,
  /** Ninguna ventana pasa de 24 h: lo anterior se purga en cada tick del cron. */
  retentionMs: 24 * 60 * 60_000,
} as const;

export interface PushSample {
  readonly at: number;
  readonly ms: number;
  readonly failed: boolean;
}

export interface DeliverySample {
  readonly at: number;
  readonly gone: boolean;
}

/** Lo que leen los chequeos: muestras dentro de sus ventanas y las últimas señales. */
export interface HealthSnapshot {
  readonly pushes: readonly PushSample[];
  readonly deliveries: readonly DeliverySample[];
  readonly lastCronTick: number | null;
  readonly aiBudget: { readonly at: number; readonly share: number } | null;
}

/** QA8: los chequeos que fallan con estas muestras. Un cron que nunca corrió cuenta como detenido. */
export function failingChecks(snapshot: HealthSnapshot, now: number): HealthCheckName[] {
  const failing: HealthCheckName[] = [];
  const pushes = snapshot.pushes.filter((p) => p.at > now - HEALTH_LIMITS.windowMs);
  if (pushes.length >= HEALTH_LIMITS.syncPushMinSamples) {
    const failed = pushes.filter((p) => p.failed).length;
    if (failed / pushes.length > HEALTH_LIMITS.syncPushFailureShare) failing.push('sync_push_errors');
    if (p95(pushes.map((p) => p.ms)) > HEALTH_LIMITS.syncPushP95Ms) failing.push('sync_push_slow');
  }
  const tick = snapshot.lastCronTick;
  if (tick === null || now - tick > HEALTH_LIMITS.cronStaleMs) failing.push('cron_stale');
  const deliveries = snapshot.deliveries.filter((d) => d.at > now - HEALTH_LIMITS.webPushWindowMs);
  if (deliveries.length >= HEALTH_LIMITS.webPushMinSamples) {
    const gone = deliveries.filter((d) => d.gone).length;
    if (gone / deliveries.length > HEALTH_LIMITS.webPushGoneShare) failing.push('web_push_gone');
  }
  const ai = snapshot.aiBudget;
  if (ai && now - ai.at < HEALTH_LIMITS.aiBudgetMaxAgeMs && ai.share > HEALTH_LIMITS.aiBudgetShare) {
    failing.push('ai_budget');
  }
  return failing;
}

/** Percentil 95 por el método del rango más cercano. */
function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

/**
 * QA8: las muestras viven en Postgres (`health_sample`) porque las escriben procesos que no
 * comparten memoria: las instancias de la función de la API y el daemon `scheduler` (ADR-018).
 * Una muestra que no se pudo guardar no rompe lo que se estaba midiendo.
 */
@Injectable()
export class HealthMetrics {
  private readonly logger = new Logger(HealthMetrics.name);

  constructor(private readonly repo: HealthRepository) {}

  /** Un `POST /sync/push` terminado; `failed` solo si fue un error del servidor. */
  recordSyncPush(at: number, ms: number, failed: boolean): Promise<void> {
    return this.save(() => this.repo.insertSample({ kind: 'sync_push', at, ms, failed }));
  }

  /** Un tick del cron de recordatorios (NT3), haya obtenido el lock o no. También purga lo viejo. */
  recordCronTick(at: number): Promise<void> {
    return this.save(async () => {
      await this.repo.insertSample({ kind: 'cron_tick', at });
      await this.repo.pruneSamples(at - HEALTH_LIMITS.retentionMs);
    });
  }

  /** Un envío de Web Push; `gone` es un 404 o 410 del servicio push (NT-T9). */
  recordPushDelivery(at: number, gone: boolean): Promise<void> {
    return this.save(() => this.repo.insertSample({ kind: 'push_delivery', at, failed: gone }));
  }

  /** La parte de la cuota diaria de IA que ya se usó (0-1+), medida tras cada pedido (LD17). */
  recordAiBudget(at: number, share: number): Promise<void> {
    return this.save(() => this.repo.insertSample({ kind: 'ai_budget', at, share }));
  }

  async failing(now: number): Promise<HealthCheckName[]> {
    return failingChecks(
      await this.repo.snapshot(now - HEALTH_LIMITS.windowMs, now - HEALTH_LIMITS.webPushWindowMs),
      now,
    );
  }

  private async save(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'No se pudo guardar una muestra de salud');
    }
  }
}
