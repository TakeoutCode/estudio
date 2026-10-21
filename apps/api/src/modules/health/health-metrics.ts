import type { HealthCheckName } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';

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
} as const;

interface PushSample {
  readonly at: number;
  readonly ms: number;
  readonly failed: boolean;
}

interface DeliverySample {
  readonly at: number;
  readonly gone: boolean;
}

/**
 * QA8: contadores en memoria de esta instancia (Railway corre una). Se pierden con un deploy,
 * y por eso el cron solo cuenta como detenido pasada su ventana desde el arranque.
 */
@Injectable()
export class HealthMetrics {
  private readonly pushes: PushSample[] = [];
  private readonly deliveries: DeliverySample[] = [];
  private lastCronTick: number | null = null;
  private aiBudget: { readonly at: number; readonly share: number } | null = null;
  private readonly startedAt: number;

  constructor(clock: Clock) {
    this.startedAt = clock.now();
  }

  /** Un `POST /sync/push` terminado; `failed` solo si fue un error del servidor. */
  recordSyncPush(at: number, ms: number, failed: boolean): void {
    this.pushes.push({ at, ms, failed });
    prune(this.pushes, at - HEALTH_LIMITS.windowMs);
  }

  /** Un tick del cron de recordatorios (NT3), haya obtenido el lock o no. */
  recordCronTick(at: number): void {
    this.lastCronTick = at;
  }

  /** Un envío de Web Push; `gone` es un 404 o 410 del servicio push (NT-T9). */
  recordPushDelivery(at: number, gone: boolean): void {
    this.deliveries.push({ at, gone });
    prune(this.deliveries, at - HEALTH_LIMITS.webPushWindowMs);
  }

  /** La parte de la cuota diaria de IA que ya se usó (0-1+), medida tras cada pedido (LD17). */
  recordAiBudget(at: number, share: number): void {
    this.aiBudget = { at, share };
  }

  failing(now: number): HealthCheckName[] {
    const failing: HealthCheckName[] = [];
    const pushes = this.pushes.filter((p) => p.at > now - HEALTH_LIMITS.windowMs);
    if (pushes.length >= HEALTH_LIMITS.syncPushMinSamples) {
      const failed = pushes.filter((p) => p.failed).length;
      if (failed / pushes.length > HEALTH_LIMITS.syncPushFailureShare) failing.push('sync_push_errors');
      if (p95(pushes.map((p) => p.ms)) > HEALTH_LIMITS.syncPushP95Ms) failing.push('sync_push_slow');
    }
    const lastSign = this.lastCronTick ?? this.startedAt;
    if (now - lastSign > HEALTH_LIMITS.cronStaleMs) failing.push('cron_stale');
    const deliveries = this.deliveries.filter((d) => d.at > now - HEALTH_LIMITS.webPushWindowMs);
    if (deliveries.length >= HEALTH_LIMITS.webPushMinSamples) {
      const gone = deliveries.filter((d) => d.gone).length;
      if (gone / deliveries.length > HEALTH_LIMITS.webPushGoneShare) failing.push('web_push_gone');
    }
    const ai = this.aiBudget;
    if (ai && now - ai.at < HEALTH_LIMITS.aiBudgetMaxAgeMs && ai.share > HEALTH_LIMITS.aiBudgetShare) {
      failing.push('ai_budget');
    }
    return failing;
  }
}

function prune(samples: { readonly at: number }[], before: number): void {
  const keep = samples.findIndex((s) => s.at > before);
  samples.splice(0, keep < 0 ? samples.length : keep);
}

/** Percentil 95 por el método del rango más cercano. */
function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}
