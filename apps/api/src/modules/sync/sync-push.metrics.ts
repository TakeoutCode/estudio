import { type CallHandler, Injectable, type NestInterceptor } from '@nestjs/common';
import { catchError, mergeMap, type Observable } from 'rxjs';
import { Clock } from '../../common/clock.js';
import { DomainError, STATUS_BY_CODE } from '../../common/domain-error.js';
import { HealthMetrics } from '../health/health-metrics.js';

/**
 * QUALITY QA8: duración y resultado de cada `POST /sync/push`. Solo un error del servidor
 * cuenta como fallo; un 4xx (cuerpo inválido, contrato viejo) es del cliente. La muestra se
 * guarda antes de responder: una función de Vercel puede pausarse apenas sale la respuesta.
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
      return this.metrics.recordSyncPush(ended, ended - started, failed);
    };
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        await record(false);
        return value;
      }),
      catchError(async (error: unknown) => {
        await record(!(error instanceof DomainError) || STATUS_BY_CODE[error.code] >= 500);
        throw error;
      }),
    );
  }
}
