import type { Reward } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/** UX10: un premio de la tienda con el nombre y el costo que ella define (LWW). */
@Injectable()
@SyncHandler('reward')
export class RewardSyncHandler implements EntitySyncHandler<'reward'> {
  readonly entity = 'reward';
  readonly table = 'reward';

  constructor(private readonly repo: StudyRepository) {}

  check(): null {
    return null;
  }

  apply(userId: string, row: Reward): Promise<ApplyStatus> {
    return this.repo.upsertRewardLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      name: d.name,
      cost: dbNumber(d.cost),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
