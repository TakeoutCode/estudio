import type { ApiErrorCode, Note } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { DecksRepository } from './decks.repository.js';

@Injectable()
@SyncHandler('note')
export class NoteSyncHandler implements EntitySyncHandler<'note'> {
  readonly entity = 'note';
  readonly table = 'note';

  constructor(private readonly repo: DecksRepository) {}

  check(): null {
    return null;
  }

  async refs(userId: string, row: Note): Promise<ApiErrorCode | null> {
    if (!(await this.repo.owns('deck', userId, row.deckId))) return 'not_found';
    // R10: la imagen de una oclusión es de ella; el asset viaja antes que la nota (outbox).
    if (
      row.content.kind === 'image_occlusion' &&
      !(await this.repo.owns('media_asset', userId, row.content.imageAssetId))
    ) {
      return 'not_found';
    }
    // Cada etiqueta es de ella (aunque esté borrada); viaja antes que la nota (outbox).
    if (!(await this.repo.ownsAll('tag', userId, row.tagIds))) return 'not_found';
    return row.topicId === null || (await this.repo.owns('topic', userId, row.topicId)) ? null : 'not_found';
  }

  apply(userId: string, row: Note): Promise<ApplyStatus> {
    return this.repo.upsertNoteLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      deckId: d.deck_id,
      topicId: d.topic_id,
      content: d.content,
      origin: d.origin,
      tagIds: d.tag_ids,
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
