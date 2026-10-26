import { type ApiErrorCode, MAX_HLC_DRIFT_MS, type ReviewLog } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { DecksRepository } from '../decks/decks.repository.js';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/** R3: el ReviewLog es solo de inserción; Postgres impide UPDATE y DELETE con un trigger. */
@Injectable()
@SyncHandler('reviewLog')
export class ReviewLogSyncHandler implements EntitySyncHandler<'reviewLog'> {
  readonly entity = 'reviewLog';
  readonly table = 'review_log';

  constructor(
    private readonly repo: StudyRepository,
    private readonly decks: DecksRepository,
  ) {}

  check(_userId: string, row: ReviewLog, now: number): ApiErrorCode | null {
    return row.reviewedAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  /** BE2: la tarjeta es de ella (aunque esté borrada: sus repasos se conservan, SYNC §5). */
  async refs(userId: string, row: ReviewLog): Promise<ApiErrorCode | null> {
    return (await this.decks.owns('card', userId, row.cardId)) ? null : 'not_found';
  }

  apply(userId: string, row: ReviewLog): Promise<ApplyStatus> {
    return this.repo.insertReviewLog(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      cardId: d.card_id,
      cardKind: d.card_kind,
      reviewedAt: dbNumber(d.reviewed_at),
      rating: dbNumber(d.rating),
      durationMs: dbNumber(d.duration_ms),
      type: d.type,
      confidence: dbNumberOrNull(d.confidence),
      sessionId: d.session_id,
      deviceId: d.device_id,
      ...(d.answer === null ? {} : { answer: d.answer }),
    };
  }
}
