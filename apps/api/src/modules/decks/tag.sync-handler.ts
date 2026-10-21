import type { Tag } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { DecksRepository } from './decks.repository.js';

/** Etiqueta de ella, entre mazos (diseño, LWW). Las notas la referencian en `tagIds`. */
@Injectable()
@SyncHandler('tag')
export class TagSyncHandler implements EntitySyncHandler<'tag'> {
  readonly entity = 'tag';
  readonly table = 'tag';

  constructor(private readonly repo: DecksRepository) {}

  check(): null {
    return null;
  }

  apply(userId: string, row: Tag): Promise<ApplyStatus> {
    return this.repo.upsertTagLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      name: d.name,
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
