import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  type BackupEntities,
  ENTITY_STRATEGY,
  type SyncedEntity,
} from '@estudio/shared';
import type { CardState } from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb, TABLE_FOR } from '@/db/schema';
import { readProfile } from '@/db/settings';

const ENTITIES = Object.keys(TABLE_FOR) as SyncedEntity[];

/**
 * QA7: todas las entidades vivas y todos los registros de solo inserción (los `ReviewLog`),
 * leídos en una sola transacción para que el respaldo sea coherente. Sin red (FE7).
 */
export async function readBackup(
  userId: string,
  now: number,
  database: EstudioDb = db,
): Promise<{ readonly backup: Backup; readonly cardStates: CardState[]; readonly timeZone: string }> {
  const tables = [
    ...ENTITIES.map((e) => database.table(TABLE_FOR[e])),
    database.cardStates,
    database.userSettings,
  ];
  return database.transaction('r', tables, async () => {
    const entities: Partial<Record<SyncedEntity, unknown[]>> = {};
    for (const entity of ENTITIES) {
      const table = database.table<{ deletedAt?: number | null }, string>(TABLE_FOR[entity]);
      entities[entity] = await (ENTITY_STRATEGY[entity] === 'append'
        ? table.toArray()
        : table.filter((row) => row.deletedAt === null).toArray());
    }
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now,
      userId,
      entities: entities as BackupEntities,
    } satisfies Backup;
    return {
      backup,
      cardStates: await database.cardStates.toArray(),
      timeZone: (await readProfile(database)).timeZone,
    };
  });
}

export interface BackupInfo {
  readonly notes: number;
  /** Imágenes que este dispositivo aún no sube: el respaldo no lleva sus bytes. */
  readonly pendingImages: number;
}

export const useBackupInfo = (): BackupInfo | undefined =>
  useLiveQuery(async () => ({
    notes: await alive(db.notes.toCollection()).count(),
    pendingImages: await db.pendingUploads.count(),
  }));
