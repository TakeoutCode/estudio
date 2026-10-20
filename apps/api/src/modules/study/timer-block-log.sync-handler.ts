import { type ApiErrorCode, MAX_HLC_DRIFT_MS, type TimerBlockLog } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/** §3 y P6: bloques y descansos cerrados. Solo inserción; un trigger impide UPDATE y DELETE. */
@Injectable()
@SyncHandler('timerBlockLog')
export class TimerBlockLogSyncHandler implements EntitySyncHandler<'timerBlockLog'> {
  readonly entity = 'timerBlockLog';
  readonly table = 'timer_block_log';

  constructor(private readonly repo: StudyRepository) {}

  check(_userId: string, row: TimerBlockLog, now: number): ApiErrorCode | null {
    return row.endedAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  async refs(userId: string, row: TimerBlockLog): Promise<ApiErrorCode | null> {
    return (await this.repo.ownsTimerSession(userId, row.timerSessionId)) ? null : 'not_found';
  }

  apply(userId: string, row: TimerBlockLog): Promise<ApplyStatus> {
    return this.repo.insertTimerBlockLog(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      timerSessionId: d.timer_session_id,
      deviceId: d.device_id,
      kind: d.kind,
      blockIndex: dbNumber(d.block_index),
      mode: d.mode,
      startedAt: dbNumber(d.started_at),
      endedAt: dbNumber(d.ended_at),
      plannedMs: dbNumber(d.planned_ms),
      activeMs: dbNumber(d.active_ms),
      outcome: d.outcome,
      extended: d.extended,
    };
  }
}
