import {
  CLIENT_ERROR_LIMITS,
  type ClientError,
  CONTRACT_VERSION,
  newId,
  redactErrorText,
  redactRoute,
} from '@estudio/shared';
import type { EstudioDb } from './schema';

// FRONTEND FE13: errores de este dispositivo, ya filtrados, esperando a enviarse. No se
// sincroniza: es solo para los logs de la API (ADR-016).

/** Un error guardado: el reporte y si ya se envió (0/1, porque IndexedDB no indexa booleanos). */
export interface DiagnosticEntry extends ClientError {
  readonly sent: 0 | 1;
  readonly sentAt: number | null;
}

/** Cuántos se guardan como máximo; los más viejos se van primero. Límite técnico. */
const KEEP = 50;
/** El mismo error en la misma ruta dentro de este lapso se guarda una sola vez (un render en bucle). */
const REPEAT_WINDOW_MS = 60_000;

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error)
    return { message: `${error.name}: ${error.message}`, stack: error.stack ?? null };
  if (typeof error === 'string') return { message: error, stack: null };
  // Un valor cualquiera (p. ej. un rechazo con un objeto) podría traer datos suyos: solo su tipo.
  return { message: `Non-Error thrown (${typeof error})`, stack: null };
}

/**
 * FE13: guarda un error con mensaje, stack, ruta y versión; nunca contenido ni respuestas: lo
 * citado se tapa y los ids salen de la ruta (`redactErrorText`, `redactRoute`).
 */
export async function recordClientError(
  database: EstudioDb,
  error: unknown,
  pathname: string,
  now: number,
): Promise<void> {
  const { message, stack } = describe(error);
  const entry: DiagnosticEntry = {
    id: newId(),
    message: redactErrorText(message, CLIENT_ERROR_LIMITS.messageMax),
    stack: stack === null ? null : redactErrorText(stack, CLIENT_ERROR_LIMITS.stackMax),
    route: redactRoute(pathname),
    appVersion: String(CONTRACT_VERSION),
    occurredAt: now,
    sent: 0,
    sentAt: null,
  };
  await database.transaction('rw', database.diagnostics, async () => {
    const repeated = await database.diagnostics
      .where('occurredAt')
      .above(now - REPEAT_WINDOW_MS)
      .filter((e) => e.message === entry.message && e.route === entry.route)
      .count();
    if (repeated > 0) return;
    await database.diagnostics.add(entry);
    const extra = (await database.diagnostics.count()) - KEEP;
    if (extra > 0) await database.diagnostics.orderBy('occurredAt').limit(extra).delete();
  });
}

const dayStart = (now: number): number => new Date(now).setHours(0, 0, 0, 0);

/** FE13: los que faltan por enviar, sin pasar de 20 enviados en el día de este dispositivo. */
export async function unsentDiagnostics(database: EstudioDb, now: number): Promise<ClientError[]> {
  const [sentToday, pending] = await Promise.all([
    database.diagnostics.where('sentAt').aboveOrEqual(dayStart(now)).count(),
    database.diagnostics.where('sent').equals(0).sortBy('occurredAt'),
  ]);
  const budget = Math.max(0, CLIENT_ERROR_LIMITS.perDay - sentToday);
  return pending.slice(0, budget).map((e): ClientError => ({
    id: e.id,
    message: e.message,
    stack: e.stack,
    route: e.route,
    appVersion: e.appVersion,
    occurredAt: e.occurredAt,
  }));
}

export async function markDiagnosticsSent(
  database: EstudioDb,
  ids: readonly string[],
  now: number,
): Promise<void> {
  await database.diagnostics
    .where('id')
    .anyOf([...ids])
    .modify({ sent: 1, sentAt: now });
}
