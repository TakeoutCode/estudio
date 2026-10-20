import type { Deck } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { DecksRepository } from './decks.repository.js';

@Injectable()
@SyncHandler('deck')
export class DeckSyncHandler implements EntitySyncHandler<'deck'> {
  readonly entity = 'deck';
  readonly table = 'deck';

  constructor(private readonly repo: DecksRepository) {}

  check(): null {
    return null;
  }

  apply(userId: string, row: Deck): Promise<ApplyStatus> {
    return this.repo.upsertDeckLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      pausedAt: dbNumberOrNull(d.paused_at),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
