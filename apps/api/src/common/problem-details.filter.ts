import type { ApiErrorCode, ProblemDetails } from '@estudio/shared';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, STATUS_BY_CODE } from './domain-error.js';

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'cursor_expired',
  413: 'validation_failed',
  422: 'validation_failed',
  426: 'contract_outdated',
  429: 'rate_limited',
  503: 'unavailable',
};

const TITLE: Record<ApiErrorCode, string> = {
  validation_failed: 'Validation failed',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not found',
  conflict: 'Conflict',
  cursor_expired: 'Sync cursor expired',
  contract_outdated: 'Client contract outdated',
  rate_limited: 'Too many requests',
  ai_quota_exceeded: 'AI quota exceeded',
  unavailable: 'Service unavailable',
  internal: 'Internal error',
};

/** Traduce cualquier excepción a un `ProblemDetails` estable (BACKEND BE5). */
export function toProblem(exception: unknown, requestId?: string): ProblemDetails {
  let code: ApiErrorCode = 'internal';
  let status = 500;
  let issues: readonly unknown[] | undefined;

  if (exception instanceof DomainError) {
    code = exception.code;
    status = STATUS_BY_CODE[code];
    issues = exception.details.issues;
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal' : 'validation_failed');
  }

  return {
    type: `https://estudio.app/errors/${code}`,
    title: TITLE[code],
    status,
    code,
    ...(requestId ? { requestId } : {}),
    ...(issues ? { issues: [...issues] } : {}),
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: unknown }>();
    const res = http.getResponse<Response>();
    const problem = toProblem(exception, typeof req.id === 'string' ? req.id : undefined);

    // Sin stack ni mensaje en la respuesta; el detalle va al log, sin el cuerpo (BE6).
    if (problem.status >= 500) this.logger.error(exception instanceof Error ? exception.stack : exception);

    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
