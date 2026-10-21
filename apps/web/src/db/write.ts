import { newId, opForEntity, type SyncedEntity, type SyncedRow } from '@estudio/shared';
import { type EstudioDb, TABLE_FOR } from './schema';

/**
 * FRONTEND FE3: escribe la fila y la encola en el outbox. Llamar dentro de una transacción
 * `rw` que incluya la tabla de la entidad, `outbox` y `meta` (el HLC ya va en la fila).
 */
export async function writeAndQueue<E extends SyncedEntity>(
  database: EstudioDb,
  entity: E,
  row: SyncedRow<E>,
  now: number,
): Promise<void> {
  const table = database.table<SyncedRow<E>, string>(TABLE_FOR[entity]);
  // SYNC SY1: la operación sale de la estrategia de la entidad, la misma que valida el servidor.
  const op = opForEntity(entity);
  if (op === 'append') await table.add(row);
  else await table.put(row);
  await database.outbox.add({
    mutationId: newId(),
    op,
    entity,
    row,
    createdAt: now,
    attempts: 0,
    status: 'pending',
  });
}
