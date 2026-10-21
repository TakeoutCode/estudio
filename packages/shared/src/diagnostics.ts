import { z } from 'zod';

// Observabilidad sin servicio externo (ARCHITECTURE ADR-016). FRONTEND FE13: los errores del
// cliente viajan ya filtrados, sin contenido de estudio ni respuestas. QUALITY QA8: los
// chequeos de salud responden solo con los nombres de lo que falla, sin datos.

/** Límites técnicos de cada error reportado (no son umbrales de estudio). */
export const CLIENT_ERROR_LIMITS = {
  messageMax: 300,
  stackMax: 2000,
  routeMax: 120,
  versionMax: 40,
  /** FE13: hasta 20 por día y por dispositivo; un lote nunca trae más. */
  perDay: 20,
} as const;

export const ClientErrorSchema = z
  .object({
    /** UUIDv7 del cliente: un reenvío no se cuenta dos veces en los logs. */
    id: z.uuid(),
    message: z.string().max(CLIENT_ERROR_LIMITS.messageMax),
    stack: z.string().max(CLIENT_ERROR_LIMITS.stackMax).nullable(),
    /** La ruta sin ids ni búsqueda (p. ej. `/notes/:id`). */
    route: z.string().max(CLIENT_ERROR_LIMITS.routeMax),
    appVersion: z.string().max(CLIENT_ERROR_LIMITS.versionMax),
    occurredAt: z.number().int().nonnegative(),
  })
  .strict();
export type ClientError = z.infer<typeof ClientErrorSchema>;

export const ClientErrorReportSchema = z
  .object({ errors: z.array(ClientErrorSchema).min(1).max(CLIENT_ERROR_LIMITS.perDay) })
  .strict();
export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

/** QA8: los chequeos que vigila el monitor de disponibilidad. */
export const HealthCheckNameSchema = z.enum([
  'database',
  'sync_push_errors',
  'sync_push_slow',
  'cron_stale',
  'web_push_gone',
]);
export type HealthCheckName = z.infer<typeof HealthCheckNameSchema>;

export const HealthChecksSchema = z
  .object({ status: z.enum(['ok', 'failing']), failing: z.array(HealthCheckNameSchema) })
  .strict();
export type HealthChecks = z.infer<typeof HealthChecksSchema>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const QUOTED = /"[^"]*"|'[^']*'|`[^`]*`|«[^»]*»|“[^”]*”/g;

/**
 * FE13: texto de un error sin lo que podría venir de ella. Los mensajes de JS a veces citan
 * el valor que falló (`"…" is not valid JSON`), así que todo lo citado se tapa; los ids se
 * cambian por `:id` y se recorta al límite.
 */
export function redactErrorText(text: string, max: number): string {
  const clean = text.replace(QUOTED, '"…"').replace(UUID, ':id');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** FE13: la ruta sin búsqueda ni fragmento y con `:id` en lugar de cada id. */
export function redactRoute(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] ?? '/').replace(UUID, ':id');
  return path.length > CLIENT_ERROR_LIMITS.routeMax ? path.slice(0, CLIENT_ERROR_LIMITS.routeMax) : path;
}
