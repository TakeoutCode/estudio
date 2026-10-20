import { z } from 'zod';

/**
 * Códigos de error estables (BACKEND BE5). El cliente los traduce a claves i18n; el texto
 * del servidor nunca llega a la UI.
 */
export const ApiErrorCodeSchema = z.enum([
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'contract_outdated',
  'rate_limited',
  'ai_quota_exceeded',
  'cursor_expired',
  'unavailable',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Cuerpo `application/problem+json` (RFC 9457) que devuelve la API. */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: ApiErrorCodeSchema,
  requestId: z.string().optional(),
  issues: z.array(z.unknown()).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
