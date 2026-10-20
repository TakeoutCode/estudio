import type { ApiErrorCode } from '@estudio/shared';

/** Error de dominio con código estable (BACKEND BE5). Los services lanzan esto, no HttpException. */
export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly details: { readonly issues?: readonly unknown[] } = {},
  ) {
    super(code);
    this.name = 'DomainError';
  }
}

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  cursor_expired: 410,
  contract_outdated: 426,
  rate_limited: 429,
  ai_quota_exceeded: 429,
  internal: 500,
  unavailable: 503,
};
