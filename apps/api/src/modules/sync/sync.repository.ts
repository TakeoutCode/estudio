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
