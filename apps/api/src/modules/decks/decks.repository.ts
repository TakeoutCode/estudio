import type { Card, Deck, Note, Topic } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { type Column, ident, syncMetaColumns, upsertLwwSql } from '../sync/sql.js';
import type { ApplyStatus } from '../sync/sync-handler.js';

/** Tablas que otras entidades referencian (BE2). */
export type OwnedTable = 'deck' | 'topic' | 'note' | 'card';

@Injectable()
export class DecksRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  private async upsert(table: string, columns: readonly Column[]): Promise<ApplyStatus> {
    const rows = await this.tx.$queryRaw<{ server_seq: bigint }[]>(upsertLwwSql(table, columns));
    return rows.length > 0 ? 'applied' : 'stale';
  }

  upsertDeckLww(userId: string, deck: Deck): Promise<ApplyStatus> {
    return this.upsert('deck', [
      { name: 'id', value: deck.id, cast: 'uuid' },
      { name: 'user_id', value: userId, cast: 'uuid' },
      { name: 'name', value: deck.name },
      { name: 'description', value: deck.description },
      ...syncMetaColumns(deck),
    ]);
  }

  upsertTopicLww(userId: string, topic: Topic): Promise<ApplyStatus> {
    return this.upsert('topic', [
      { name: 'id', value: topic.id, cast: 'uuid' },
      { name: 'user_id', value: userId, cast: 'uuid' },
      { name: 'deck_id', value: topic.deckId, cast: 'uuid' },
      { name: 'name', value: topic.name },
      { name: 'explanation', value: topic.explanation },
      ...syncMetaColumns(topic),
    ]);
  }

  upsertNoteLww(userId: string, note: Note): Promise<ApplyStatus> {
    return this.upsert('note', [
      { name: 'id', value: note.id, cast: 'uuid' },
      { name: 'user_id', value: userId, cast: 'uuid' },
      { name: 'deck_id', value: note.deckId, cast: 'uuid' },
      { name: 'topic_id', value: note.topicId, cast: 'uuid' },
      { name: 'kind', value: note.content.kind },
      { name: 'content', value: JSON.stringify(note.content), cast: 'jsonb' },
      { name: 'origin', value: note.origin },
      ...syncMetaColumns(note),
    ]);
  }

  upsertCardLww(userId: string, card: Card): Promise<ApplyStatus> {
    return this.upsert('card', [
      { name: 'id', value: card.id, cast: 'uuid' },
      { name: 'user_id', value: userId, cast: 'uuid' },
      { name: 'note_id', value: card.noteId, cast: 'uuid' },
      { name: 'ordinal', value: card.ordinal, cast: 'integer' },
      { name: 'created_at', value: card.createdAt, cast: 'bigint' },
      { name: 'lapse_baseline', value: card.lapseBaseline, cast: 'integer' },
      ...syncMetaColumns(card),
    ]);
  }

  /**
   * BE2: la fila existe y es de ella. Las borradas cuentan: sus repasos se conservan
   * (SYNC §5) y una edición puede revivirlas.
   */
  /** BE2: todas las filas existen y son de ella (una sola consulta). */
  async ownsAll(table: OwnedTable, userId: string, ids: readonly string[]): Promise<boolean> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return true;
    const rows = await this.tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM ${ident(table)}
      WHERE "user_id" = ${userId}::uuid AND "id" = ANY(${unique}::uuid[])`;
    return Number(rows[0]?.n ?? 0) === unique.length;
  }

  async owns(table: OwnedTable, userId: string, id: string): Promise<boolean> {
    const rows = await this.tx.$queryRaw<unknown[]>`
      SELECT 1 FROM ${ident(table)} WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid`;
    return rows.length > 0;
  }
}
