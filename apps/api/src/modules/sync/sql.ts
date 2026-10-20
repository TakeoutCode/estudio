import type { SyncMeta } from '@estudio/shared';
import { Prisma } from '../../generated/prisma/client.js';

// SQL de sync (SYNC §3, BACKEND BE9): todo valor va como parámetro; los identificadores
// salen de constantes del código y se validan contra un patrón estricto.

export interface Column {
  readonly name: string;
  readonly value: unknown;
  readonly cast?: 'uuid' | 'jsonb' | 'bigint' | 'smallint' | 'integer';
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function ident(name: string): Prisma.Sql {
  if (!IDENTIFIER.test(name)) throw new Error(`Identificador SQL no permitido: ${name}`);
  return Prisma.raw(`"${name}"`);
}

const param = (column: Column): Prisma.Sql =>
  column.cast ? Prisma.sql`${column.value}::${Prisma.raw(column.cast)}` : Prisma.sql`${column.value}`;

/** Columnas comunes de toda entidad LWW. */
export const syncMetaColumns = (row: SyncMeta): Column[] => [
  { name: 'hlc', value: row.hlc },
  { name: 'updated_at', value: row.updatedAt, cast: 'bigint' },
  { name: 'deleted_at', value: row.deletedAt, cast: 'bigint' },
];

/**
 * Upsert LWW: escribe solo si el HLC entrante es mayor (byte a byte, COLLATE "C") y la
 * fila existente es del mismo usuario. Devuelve 0 filas si perdió (`stale`).
 */
export function upsertLwwSql(table: string, columns: readonly Column[]): Prisma.Sql {
  const t = ident(table);
  const updates = columns
    .filter((c) => c.name !== 'id' && c.name !== 'user_id')
    .map((c) => Prisma.sql`${ident(c.name)} = EXCLUDED.${ident(c.name)}`);
  return Prisma.sql`
    INSERT INTO ${t} (${Prisma.join(columns.map((c) => ident(c.name)))}, "server_seq")
    VALUES (${Prisma.join(columns.map(param))}, nextval('sync_seq'))
    ON CONFLICT ("id") DO UPDATE SET ${Prisma.join(updates)}, "server_seq" = nextval('sync_seq')
    WHERE ${t}."user_id" = EXCLUDED."user_id"
      AND ${t}."hlc" COLLATE "C" < EXCLUDED."hlc" COLLATE "C"
    RETURNING "server_seq"`;
}

/** Inserción de solo-append: un `id` repetido no hace nada (`duplicate`). */
export function insertAppendSql(table: string, columns: readonly Column[]): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO ${ident(table)} (${Prisma.join(columns.map((c) => ident(c.name)))}, "server_seq")
    VALUES (${Prisma.join(columns.map(param))}, nextval('sync_seq'))
    ON CONFLICT ("id") DO NOTHING
    RETURNING "server_seq"`;
}

/** Lectura de columnas que llegan de `to_jsonb(fila)`. */
export const dbNumber = (value: unknown): number => Number(value);
export const dbNumberOrNull = (value: unknown): number | null => (value === null ? null : Number(value));
