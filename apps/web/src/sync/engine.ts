import {
  compareHlc,
  ENTITY_STRATEGY,
  isSyncedEntity,
  MAX_MUTATIONS_PER_PUSH,
  type Mutation,
  opForEntity,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncedEntity,
  type SyncMeta,
  SYNC_ROW_SCHEMAS,
} from '@estudio/shared';
import { z } from 'zod';
import { deviceId, observeHlc } from '@/db/clock';
import type { projectCards as ProjectCardsFn } from '@/db/projection';
import {
  type EstudioDb,
  FULL_RESYNC_KEY,
  type OutboxEntry,
  SERVER_OFFSET_KEY,
  SYNC_CURSOR_KEY,
  syncedTables,
  TABLE_FOR,
} from '@/db/schema';
import { ApiError } from '@/lib/api';

// Motor de sync del cliente (SYNC §3-§6). Sin estado propio: la base y el transporte entran
// como parámetros, así se prueba contra un servidor falso y con varias réplicas.

export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: string): Promise<PullResponse>;
}

export interface SyncReport {
  readonly pushed: number;
  readonly rejected: number;
  readonly pulled: number;
}

const CURSOR_KEY = SYNC_CURSOR_KEY;
type ProjectCards = typeof ProjectCardsFn;

/** FE9: srs (ts-fsrs) fuera del JS inicial; la sync lo carga al bajar el primer cambio. */
const loadProjection = async (): Promise<ProjectCards> => (await import('@/db/projection')).projectCards;

const OFFSET_KEY = SERVER_OFFSET_KEY;

/**
 * SY1: la operación sale siempre de ENTITY_STRATEGY, no de la entrada guardada. Una versión
 * anterior encolaba los TimerBlockLog como `upsert`, y el servidor rechazaba el lote entero.
 */
const toMutation = ({ mutationId, entity, row }: OutboxEntry): Mutation => ({
  mutationId,
  op: opForEntity(entity),
  entity,
  row,
});

/** SY8: envía el outbox por lotes, en orden de creación (UUIDv7). Lo rechazado se queda. */
export async function pushOutbox(
  database: EstudioDb,
  transport: SyncTransport,
): Promise<{ pushed: number; rejected: number }> {
  let pushed = 0;
  let rejected = 0;
  const device = await database.transaction('rw', database.meta, () => deviceId(database));
  for (;;) {
    const batch = (await database.outbox.where('status').equals('pending').sortBy('mutationId')).slice(
      0,
      MAX_MUTATIONS_PER_PUSH,
    );
    if (batch.length === 0) break;
    const { results } = await transport.push({ deviceId: device, mutations: batch.map(toMutation) });
    let settled = 0;
    await database.transaction('rw', database.outbox, async () => {
      for (const result of results) {
        const entry = await database.outbox.get(result.mutationId);
        if (!entry) continue;
        settled += 1;
        if (result.status === 'rejected') {
          rejected += 1;
          await database.outbox.update(result.mutationId, {
            status: 'rejected',
            attempts: entry.attempts + 1,
            ...(result.code ? { code: result.code } : {}),
          });
        } else {
          pushed += 1; // applied, duplicate o stale: el servidor ya tiene su versión
          await database.outbox.delete(result.mutationId);
        }
      }
    });
    if (settled === 0) throw new Error('push_without_results'); // nunca repetir el mismo lote sin fin
  }
  return { pushed, rejected };
}

async function readCursor(database: EstudioDb): Promise<string> {
  const stored = z.string().safeParse((await database.meta.get(CURSOR_KEY))?.value);
  return stored.success ? stored.data : '0';
}

/**
 * SY4: aplica una página en una sola transacción. LWW solo si el HLC remoto es mayor (puede
 * haber una edición local sin enviar); append solo si no existe; el cursor va en la misma
 * transacción que los datos.
 */
export async function applyPage(
  database: EstudioDb,
  page: PullResponse,
  now: number,
  projectCards: ProjectCards,
): Promise<void> {
  await database.transaction('rw', syncedTables(database), async () => {
    let newest: string | null = null;
    const touchedCards: string[] = [];
    for (const change of page.changes) {
      if (!isSyncedEntity(change.entity)) continue; // entidad de una versión más nueva de la app
      const entity: SyncedEntity = change.entity;
      const row = SYNC_ROW_SCHEMAS[entity].parse(change.row);
      const table = database.table<{ id: string }, string>(TABLE_FOR[entity]);
      const cardId = cardTouchedBy(entity, row);
      if (cardId) touchedCards.push(cardId);

      if (ENTITY_STRATEGY[entity] === 'append') {
        if (!(await table.get(row.id))) await table.add(row);
        continue;
      }
      const remote = row as SyncMeta;
      const local = (await table.get(row.id)) as SyncMeta | undefined;
      if (!local || compareHlc(remote.hlc, local.hlc) > 0) {
        // SY5: un borrado remoto que gana elimina la fila local.
        if (remote.deletedAt === null) await table.put(row);
        else await table.delete(row.id);
      }
      if (!newest || compareHlc(remote.hlc, newest) > 0) newest = remote.hlc;
    }
    if (newest) await observeHlc(database, newest, now);
    // ARC5: la proyección se reconstruye en la misma transacción que los datos que la cambian.
    await projectCards(database, touchedCards);
    await database.meta.put({ key: CURSOR_KEY, value: page.cursor });
    await database.meta.put({ key: OFFSET_KEY, value: page.serverNow - now });
  });
}

/** Tarjeta cuya proyección cambia con esta fila: la propia tarjeta o la de un repaso. */
function cardTouchedBy(entity: SyncedEntity, row: { id: string }): string | null {
  if (entity === 'card') return row.id;
  if (entity === 'reviewLog' && 'cardId' in row && typeof row.cardId === 'string') return row.cardId;
  return null;
}

/** SY9 y §4: tras un 410, se vacían las tablas sincronizadas; el outbox se conserva. */
async function resetForFullResync(database: EstudioDb): Promise<void> {
  await database.transaction('rw', syncedTables(database), async () => {
    await Promise.all(
      [
        database.decks,
        database.topics,
        database.tags,
        database.notes,
        database.cards,
        database.exams,
        database.contrastGroups,
        database.mediaAssets, // pendingUploads se queda: son bytes de este dispositivo sin subir
        database.userSettings,
        database.selfExplanations,
        database.studySessions,
        database.reviewLogs,
        database.timerSessions,
        database.timerBlockLogs,
        database.sleepLogs,
        database.rewards,
        database.rewardRedemptions,
        database.aiDrafts,
        database.aiFeedback,
        database.cardStates,
      ].map((table) => table.clear()),
    );
    await database.meta.put({ key: CURSOR_KEY, value: '0' });
    await database.meta.put({ key: FULL_RESYNC_KEY, value: true });
  });
}

/** Vuelve a poner en local lo que sigue en el outbox después de un pull completo. */
async function reapplyOutbox(database: EstudioDb, projectCards: ProjectCards): Promise<void> {
  const pending = await database.outbox.toArray();
  await database.transaction('rw', syncedTables(database), async () => {
    const touchedCards: string[] = [];
    for (const entry of pending) {
      if (!isSyncedEntity(entry.entity)) continue;
      const table = database.table<{ id: string }, string>(TABLE_FOR[entry.entity]);
      const row = entry.row as { id: string; hlc?: string; deletedAt?: number | null };
      const cardId = cardTouchedBy(entry.entity, row);
      if (cardId) touchedCards.push(cardId);
      const local = (await table.get(row.id)) as SyncMeta | undefined;
      if (ENTITY_STRATEGY[entry.entity] === 'append') {
        if (!local) await table.add(row);
      } else if (!local || (row.hlc && compareHlc(row.hlc, local.hlc) > 0)) {
        if (row.deletedAt === null) await table.put(row);
        else await table.delete(row.id);
      }
    }
    await projectCards(database, touchedCards);
    await database.meta.delete(FULL_RESYNC_KEY);
  });
}

/** SY3, SY4: pull hasta `hasMore = false`. */
export async function pullAll(
  database: EstudioDb,
  transport: SyncTransport,
  now: () => number,
): Promise<number> {
  // Antes de cualquier transacción: dentro de una, esperar el import la cerraría.
  const projectCards = await loadProjection();
  let pulled = 0;
  let cursor = await readCursor(database);
  // Un pull completo que quedó a medias (la app se cerró) sigue pendiente de reaplicar el outbox.
  let resyncPending = (await database.meta.get(FULL_RESYNC_KEY))?.value === true;
  let resetNow = false;
  for (;;) {
    let page: PullResponse;
    try {
      page = await transport.pull(cursor);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'cursor_expired' && !resetNow) {
        await resetForFullResync(database);
        resyncPending = true;
        resetNow = true;
        cursor = '0';
        continue;
      }
      throw error;
    }
    await applyPage(database, page, now(), projectCards);
    pulled += page.changes.length;
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  if (resyncPending) await reapplyOutbox(database, projectCards);
  return pulled;
}

/** Un ciclo completo: primero se vacía el outbox, luego se baja todo lo nuevo (SYNC §4). */
export async function syncOnce(
  database: EstudioDb,
  transport: SyncTransport,
  now: () => number = Date.now,
): Promise<SyncReport> {
  const { pushed, rejected } = await pushOutbox(database, transport);
  const pulled = await pullAll(database, transport, now);
  return { pushed, rejected, pulled };
}
