import { type AiDraft, newId } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { syncMetaColumns, upsertLwwSql } from '../sync/sql.js';
import type { ApplyStatus } from '../sync/sync-handler.js';

export interface UsageToday {
  /** Pedidos de ella (el primer intento de cada uno; el reintento no cuenta como otro). */
  readonly requests: number;
  readonly tokens: number;
}

export interface UsageRow {
  readonly userId: string;
  readonly localDate: string;
  readonly task: string;
  readonly attempt: number;
  readonly model: string;
  readonly status: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
}

@Injectable()
export class AiRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  /** La sección `profile` de sus ajustes, sin validar (el service la parsea, ARC9). */
  async profileOf(userId: string): Promise<unknown> {
    const row = await this.tx.userSettings.findUnique({
      where: { userId_section: { userId, section: 'profile' } },
      select: { data: true, deletedAt: true },
    });
    return row?.deletedAt === null ? row.data : {};
  }

  async usageOn(userId: string, localDate: string): Promise<UsageToday> {
    const [requests, tokens] = await Promise.all([
      this.tx.aiUsage.count({ where: { userId, localDate, attempt: 1 } }),
      this.tx.aiUsage.aggregate({
        where: { userId, localDate },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);
    return { requests, tokens: (tokens._sum.inputTokens ?? 0) + (tokens._sum.outputTokens ?? 0) };
  }

  /** LD17, BE6: tokens, modelo, latencia y estado; nunca el contenido. */
  async recordUsage(row: UsageRow): Promise<void> {
    await this.tx.aiUsage.create({ data: { id: newId(), ...row } });
  }

  async upsertDraftLww(userId: string, d: AiDraft): Promise<ApplyStatus> {
    const rows = await this.tx.$queryRaw<{ server_seq: bigint }[]>(
      upsertLwwSql('ai_draft', [
        { name: 'id', value: d.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'kind', value: d.kind },
        { name: 'deck_id', value: d.deckId, cast: 'uuid' },
        { name: 'draft', value: JSON.stringify(d.draft), cast: 'jsonb' },
        { name: 'supported', value: d.supported },
        { name: 'edited', value: d.edited },
        { name: 'status', value: d.status },
        { name: 'note_id', value: d.noteId, cast: 'uuid' },
        { name: 'created_at', value: d.createdAt, cast: 'bigint' },
        ...syncMetaColumns(d),
      ]),
    );
    return rows.length > 0 ? 'applied' : 'stale';
  }

  /** BE2: el mazo o la nota existen y son de ella (aunque estén borrados). */
  async owns(table: 'deck' | 'note', userId: string, id: string): Promise<boolean> {
    const rows =
      table === 'deck'
        ? await this.tx.$queryRaw<unknown[]>`
            SELECT 1 FROM "deck" WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid`
        : await this.tx.$queryRaw<unknown[]>`
            SELECT 1 FROM "note" WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid`;
    return rows.length > 0;
  }
}
