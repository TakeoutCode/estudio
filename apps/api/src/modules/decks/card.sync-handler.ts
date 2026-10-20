import type { ApiErrorCode, Card } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { DecksRepository } from './decks.repository.js';

/** El estado FSRS no viaja: cada lado lo reconstruye con `replay()` sobre el ReviewLog (ARC5). */
@Injectable()
@SyncHandler('card')
export class CardSyncHandler implements EntitySyncHandler<'card'> {
  readonly entity = 'card';
  readonly table = 'card';

  constructor(private readonly repo: DecksRepository) {}

  check(): null {
    return null;
  }

  async refs(userId: string, row: Card): Promise<ApiErrorCode | null> {
    return (await this.repo.owns('note', userId, row.noteId)) ? null : 'not_found';
  }

  apply(userId: string, row: Card): Promise<ApplyStatus> {
    return this.repo.upsertCardLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      noteId: d.note_id,
      ordinal: dbNumber(d.ordinal),
      createdAt: dbNumber(d.created_at),
      lapseBaseline: dbNumber(d.lapse_baseline),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
