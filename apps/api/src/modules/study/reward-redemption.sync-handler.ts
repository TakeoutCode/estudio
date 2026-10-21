import { type ApiErrorCode, MAX_HLC_DRIFT_MS, type RewardRedemption } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/**
 * UX10: un canje de premio. Solo inserción; un trigger impide UPDATE y DELETE. El saldo no se
 * valida aquí: se calcula con srs y dos canjes sin red en dos dispositivos pueden sumar más.
 */
@Injectable()
@SyncHandler('rewardRedemption')
export class RewardRedemptionSyncHandler implements EntitySyncHandler<'rewardRedemption'> {
  readonly entity = 'rewardRedemption';
  readonly table = 'reward_redemption';

  constructor(private readonly repo: StudyRepository) {}

  check(_userId: string, row: RewardRedemption, now: number): ApiErrorCode | null {
    return row.redeemedAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  async refs(userId: string, row: RewardRedemption): Promise<ApiErrorCode | null> {
    return (await this.repo.ownsReward(userId, row.rewardId)) ? null : 'not_found';
  }

  apply(userId: string, row: RewardRedemption): Promise<ApplyStatus> {
    return this.repo.insertRewardRedemption(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      rewardId: d.reward_id,
      name: d.name,
      cost: dbNumber(d.cost),
      redeemedAt: dbNumber(d.redeemed_at),
      deviceId: d.device_id,
    };
  }
}
