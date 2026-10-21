import { type CallHandler, Injectable, type NestInterceptor } from '@nestjs/common';
import { type Observable, tap } from 'rxjs';
import { Clock } from '../../common/clock.js';
import { DomainError, STATUS_BY_CODE } from '../../common/domain-error.js';
import { HealthMetrics } from '../health/health-metrics.js';

/**
 * QUALITY QA8: duración y resultado de cada `POST /sync/push`. Solo un error del servidor
 * cuenta como fallo; un 4xx (cuerpo inválido, contrato viejo) es del cliente.
 */
@Injectable()
export class SyncPushMetrics implements NestInterceptor {
  constructor(
    private readonly metrics: HealthMetrics,
    private readonly clock: Clock,
  ) {}

  intercept(_context: unknown, next: CallHandler): Observable<unknown> {
    const started = this.clock.now();
    const record = (failed: boolean) => {
      const ended = this.clock.now();
      this.metrics.recordSyncPush(ended, ended - started, failed);
    };
    return next.handle().pipe(
      tap({
        next: () => {
          record(false);
        },
        error: (error: unknown) => {
          record(!(error instanceof DomainError) || STATUS_BY_CODE[error.code] >= 500);
        },
      }),
    );
  }
}
