import { z } from 'zod';
import { SYNC_ROW_SCHEMAS, type SyncedEntity, type SyncedRow } from '../sync/row-schemas.js';

// Respaldo de ella (QUALITY QA7): un JSON que se descarga sin red y se puede importar en este u
// otro dispositivo. Se valida con este esquema al importar (AGENTS AG2).

export const BACKUP_FORMAT = 'estudio-backup';
/** Sube cuando cambia la forma del archivo; una app vieja no importa un respaldo más nuevo. */
export const BACKUP_VERSION = 1;

type EntitiesShape = { [E in SyncedEntity]: z.ZodDefault<z.ZodArray<(typeof SYNC_ROW_SCHEMAS)[E]>> };

/**
 * Las filas de cada entidad sincronizable, como viajan por sync. Una entidad que no estaba
 * cuando se hizo el respaldo llega vacía.
 */
export const BackupEntitiesSchema = z.object(
  Object.fromEntries(
    Object.entries(SYNC_ROW_SCHEMAS).map(([entity, schema]) => [entity, z.array(schema).default([])]),
  ) as unknown as EntitiesShape,
);
export type BackupEntities = { readonly [E in SyncedEntity]: readonly SyncedRow<E>[] };

export const BackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.number().int().nonnegative(),
  /** La cuenta de origen: si es la misma, al importar se conservan los ids. */
  userId: z.uuid(),
  entities: BackupEntitiesSchema,
});
export type Backup = Omit<z.output<typeof BackupSchema>, 'entities'> & { readonly entities: BackupEntities };

export type BackupProblem = 'invalid' | 'newer';

/** Lee un respaldo: `newer` si lo hizo una versión más nueva de la app (no se adivina su forma). */
export function parseBackup(raw: unknown): { readonly backup: Backup } | { readonly problem: BackupProblem } {
  const head = z.object({ format: z.literal(BACKUP_FORMAT), version: z.number().int() }).safeParse(raw);
  if (!head.success) return { problem: 'invalid' };
  if (head.data.version > BACKUP_VERSION) return { problem: 'newer' };
  const parsed = BackupSchema.safeParse(raw);
  return parsed.success ? { backup: parsed.data } : { problem: 'invalid' };
}
