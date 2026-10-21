import { type ApiErrorCode, MAX_HLC_DRIFT_MS, type SleepLog, sleepLogIdFor } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/** §5: calidad de una noche (1-5), opcional. Solo contexto: no toca FSRS ni los avisos. */
@Injectable()
@SyncHandler('sleepLog')
export class SleepLogSyncHandler implements EntitySyncHandler<'sleepLog'> {
  readonly entity = 'sleepLog';
  readonly table = 'sleep_log';

  constructor(private readonly repo: StudyRepository) {}

  /** SYNC §1: una fila por noche con id determinista; otro id duplicaría la noche. */
  check(userId: string, row: SleepLog, now: number): ApiErrorCode | null {
    if (row.id !== sleepLogIdFor(userId, row.date)) return 'validation_failed';
    return row.loggedAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  apply(userId: string, row: SleepLog): Promise<ApplyStatus> {
    return this.repo.upsertSleepLogLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      date: d.date,
      quality: dbNumber(d.quality),
      loggedAt: dbNumber(d.logged_at),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
