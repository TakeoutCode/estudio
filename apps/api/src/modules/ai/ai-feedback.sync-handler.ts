import { type AiFeedback, type ApiErrorCode, MAX_HLC_DRIFT_MS } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { AiRepository } from './ai.repository.js';

/** LD14: retroalimentación de una respuesta abierta. Solo inserción; un trigger impide UPDATE y DELETE. */
@Injectable()
@SyncHandler('aiFeedback')
export class AiFeedbackSyncHandler implements EntitySyncHandler<'aiFeedback'> {
  readonly entity = 'aiFeedback';
  readonly table = 'ai_feedback';

  constructor(private readonly repo: AiRepository) {}

  check(_userId: string, row: AiFeedback, now: number): ApiErrorCode | null {
    return row.requestedAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  /** BE2: la tarjeta es de ella (aunque esté borrada). */
  async refs(userId: string, row: AiFeedback): Promise<ApiErrorCode | null> {
    return (await this.repo.owns('card', userId, row.cardId)) ? null : 'not_found';
  }

  apply(userId: string, row: AiFeedback): Promise<ApplyStatus> {
    return this.repo.insertFeedback(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      cardId: d.card_id,
      requestedAt: dbNumber(d.requested_at),
      feedback: d.feedback,
    };
  }
}
