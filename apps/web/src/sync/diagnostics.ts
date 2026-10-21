import type { ClientErrorReport } from '@estudio/shared';
import { markDiagnosticsSent, recordClientError, unsentDiagnostics } from '@/db/diagnostics';
import type { EstudioDb } from '@/db/schema';

export interface DiagnosticsTransport {
  send(report: ClientErrorReport): Promise<void>;
}

/**
 * FRONTEND FE13: envía los errores pendientes de este dispositivo, hasta 20 al día. Un fallo
 * aquí no es un fallo de la sync: lo no enviado espera a la próxima vuelta.
 */
export async function sendDiagnostics(
  database: EstudioDb,
  transport: DiagnosticsTransport,
  now: number,
): Promise<number> {
  const errors = await unsentDiagnostics(database, now);
  if (errors.length === 0) return 0;
  try {
    await transport.send({ errors });
  } catch {
    return 0;
  }
  await markDiagnosticsSent(
    database,
    errors.map((e) => e.id),
    now,
  );
  return errors.length;
}

/** FE13: guarda un error (de un error boundary o global) para enviarlo después. Nunca lanza. */
export function reportClientError(database: EstudioDb, error: unknown, pathname: string): void {
  void recordClientError(database, error, pathname, Date.now()).catch(() => undefined);
}
