import type { SyncedEntity } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { ident } from './sql.js';

export interface ChangeRow {
  readonly entity: SyncedEntity;
  readonly server_seq: bigint;
  readonly data: Record<string, unknown>;
}

@Injectable()
export class SyncRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  /** ADR-005: serializa los push de un usuario; `server_seq` crece en orden de commit. */
  async lockUser(userId: string): Promise<void> {
    await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
  }

  /** `false` si la mutación ya se había aplicado (`duplicate`). */
  async recordMutation(userId: string, mutationId: string): Promise<boolean> {
    const inserted = await this.tx.$executeRaw`
      INSERT INTO "applied_mutation" ("user_id", "mutation_id")
      VALUES (${userId}::uuid, ${mutationId}::uuid)
      ON CONFLICT DO NOTHING`;
    return inserted === 1;
  }

  async purgedThroughSeq(userId: string): Promise<bigint> {
    const user = await this.tx.user.findUnique({ where: { id: userId }, select: { purgedThroughSeq: true } });
    return user?.purgedThroughSeq ?? 0n;
  }

  /** ARC7: una sola purga a la vez; el lock se suelta al terminar la transacción. */
  async tryJobLock(key: string): Promise<boolean> {
    const rows = await this.tx.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
    return rows[0]?.ok === true;
  }

  /** SYNC §3: el push sigue siendo idempotente sin ellas (HLC igual nunca gana; append choca). */
  async purgeAppliedMutations(before: Date): Promise<number> {
    return this.tx.$executeRaw`DELETE FROM "applied_mutation" WHERE "applied_at" < ${before}`;
  }

  /** SYNC §6: borrados anteriores a `cutoff` (ms), de todas las cuentas, hasta `limit`. */
  async tombstones(table: string, cutoff: number, limit: number): Promise<{ user_id: string; id: string }[]> {
    return this.tx.$queryRaw<{ user_id: string; id: string }[]>`
      SELECT "user_id"::text AS "user_id", "id"::text AS "id" FROM ${ident(table)}
      WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${cutoff}::bigint
      ORDER BY "user_id", "server_seq"
      LIMIT ${limit}`;
  }

  /**
   * Borra físicamente esos tombstones y devuelve sus `server_seq`. Vuelve a exigir que sigan
   * borrados y antes de `cutoff`: uno revivido o vuelto a borrar mientras tanto se queda.
   */
  async purgeTombstones(
    userId: string,
    table: string,
    ids: readonly string[],
    cutoff: number,
  ): Promise<bigint[]> {
    const rows = await this.tx.$queryRaw<{ server_seq: bigint }[]>`
      DELETE FROM ${ident(table)}
      WHERE "user_id" = ${userId}::uuid AND "id" = ANY(${ids}::uuid[])
        AND "deleted_at" IS NOT NULL AND "deleted_at" < ${cutoff}::bigint
      RETURNING "server_seq"`;
    return rows.map((r) => r.server_seq);
  }

  /** SYNC §4: un cursor por debajo de esto pudo no ver un borrado que ya no existe → 410. */
  async raisePurgedThroughSeq(userId: string, seq: bigint): Promise<void> {
    await this.tx.$executeRaw`
      UPDATE "user" SET "purged_through_seq" = GREATEST("purged_through_seq", ${seq}::bigint)
      WHERE "id" = ${userId}::uuid`;
  }

  /**
   * SYNC SY3: cambios del usuario con `server_seq > cursor`, en orden, de todas las tablas.
   * Postgres lo resuelve con Merge Append sobre los índices (user_id, server_seq).
   */
  async changesSince(
    userId: string,
    cursor: bigint,
    limit: number,
    tables: readonly { readonly entity: SyncedEntity; readonly table: string }[],
  ): Promise<ChangeRow[]> {
    const branches = tables.map(
      ({ entity, table }) => Prisma.sql`
        SELECT ${entity}::text AS "entity", t."server_seq", to_jsonb(t) AS "data"
        FROM ${ident(table)} t
        WHERE t."user_id" = ${userId}::uuid AND t."server_seq" > ${cursor}::bigint`,
    );
    if (branches.length === 0) return [];
    return this.tx.$queryRaw<ChangeRow[]>`
      SELECT * FROM (${Prisma.join(branches, ' UNION ALL ')}) AS "changes"
      ORDER BY "server_seq"
      LIMIT ${limit}`;
  }
}
