import type { ApiErrorCode, ContrastGroup } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { DecksRepository } from './decks.repository.js';

/** R9, LD10: notas que se confunden, con su brazo del A/B (LWW). */
@Injectable()
@SyncHandler('contrastGroup')
export class ContrastGroupSyncHandler implements EntitySyncHandler<'contrastGroup'> {
  readonly entity = 'contrastGroup';
  readonly table = 'contrast_group';

  constructor(private readonly repo: DecksRepository) {}

  check(): null {
    return null;
  }

  /** BE2: cada nota del grupo es de ella (aunque esté borrada). */
  async refs(userId: string, row: ContrastGroup): Promise<ApiErrorCode | null> {
    return (await this.repo.ownsAll('note', userId, row.noteIds)) ? null : 'not_found';
  }

  apply(userId: string, row: ContrastGroup): Promise<ApplyStatus> {
    return this.repo.upsertContrastGroupLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      name: d.name,
      noteIds: d.note_ids,
      abSeed: dbNumber(d.ab_seed),
      abArm: d.ab_arm,
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
