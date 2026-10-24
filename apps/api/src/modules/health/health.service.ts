import { createHash, timingSafeEqual } from 'node:crypto';
import type { HealthCheckName, HealthChecks } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import { AppConfig } from '../../config/app-config.js';
import { HealthMetrics } from './health-metrics.js';
import { HealthRepository } from './health.repository.js';

export interface HealthStatus {
  readonly status: 'ok';
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

@Injectable()
export class HealthService {
  constructor(
    private readonly repo: HealthRepository,
    private readonly metrics: HealthMetrics,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  /** QUALITY QA8: 503 si la base no responde. */
  async check(): Promise<HealthStatus> {
    try {
      await this.repo.ping();
    } catch {
      throw new DomainError('unavailable');
    }
    return { status: 'ok' };
  }

  /**
   * QA8: los chequeos para el monitor de disponibilidad, solo con el token. Con otro token (o
   * sin token configurado) responde como una ruta que no existe. Solo nombres, sin datos.
   */
  async checks(token: string): Promise<HealthChecks> {
    const expected = this.config.get('HEALTH_CHECK_TOKEN');
    // Se comparan los SHA-256 para que el tiempo no dependa del largo ni del prefijo.
    if (expected === undefined || !timingSafeEqual(digest(token), digest(expected))) {
      throw new DomainError('not_found');
    }
    const failing: HealthCheckName[] = [];
    try {
      await this.repo.ping();
    } catch {
      failing.push('database');
    }
    failing.push(...(await this.metrics.failing(this.clock.now())));
    return { status: failing.length === 0 ? 'ok' : 'failing', failing };
  }
}
