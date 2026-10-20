import type { ApiErrorCode, Topic } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { DecksRepository } from './decks.repository.js';

/** LD5, R5: tema de un mazo con la explicación del concepto (LWW). */
@Injectable()
@SyncHandler('topic')
export class TopicSyncHandler implements EntitySyncHandler<'topic'> {
  readonly entity = 'topic';
  readonly table = 'topic';

  constructor(private readonly repo: DecksRepository) {}

  check(): null {
    return null;
  }

  async refs(userId: string, row: Topic): Promise<ApiErrorCode | null> {
    return (await this.repo.owns('deck', userId, row.deckId)) ? null : 'not_found';
  }

  apply(userId: string, row: Topic): Promise<ApplyStatus> {
    return this.repo.upsertTopicLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      deckId: d.deck_id,
      name: d.name,
      explanation: d.explanation,
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
