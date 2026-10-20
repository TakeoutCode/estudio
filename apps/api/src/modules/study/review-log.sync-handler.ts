import { type ApiErrorCode, MAX_HLC_DRIFT_MS, type ReviewLog } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { dbNumber, dbNumberOrNull, insertAppendSql } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';

/**
 * R3: el ReviewLog es solo de inserción; Postgres impide UPDATE y DELETE con un trigger.
 * La verificación de que `cardId` sea de ella llega con la entidad Card (BE2).
 */
@Injectable()
@SyncHandler('reviewLog')
export class ReviewLogSyncHandler implements EntitySyncHandler<'reviewLog'> {
  readonly entity = 'reviewLog';
  readonly table = 'review_log';

  constructor(private readonly txHost: TransactionHost) {}

  check(_userId: string, row: ReviewLog, now: number): ApiErrorCode | null {
    return row.reviewedAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  async apply(userId: string, row: ReviewLog): Promise<ApplyStatus> {
    const rows = await (this.txHost as PrismaTxHost).tx.$queryRaw<{ server_seq: bigint }[]>(
      insertAppendSql('review_log', [
        { name: 'id', value: row.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'card_id', value: row.cardId, cast: 'uuid' },
        { name: 'card_kind', value: row.cardKind },
        { name: 'reviewed_at', value: row.reviewedAt, cast: 'bigint' },
        { name: 'rating', value: row.rating, cast: 'smallint' },
        { name: 'duration_ms', value: row.durationMs, cast: 'integer' },
        { name: 'type', value: row.type },
        { name: 'confidence', value: row.confidence, cast: 'smallint' },
        { name: 'session_id', value: row.sessionId, cast: 'uuid' },
        { name: 'device_id', value: row.deviceId, cast: 'uuid' },
        { name: 'answer', value: row.answer ? JSON.stringify(row.answer) : null, cast: 'jsonb' },
      ]),
    );
    return rows.length > 0 ? 'applied' : 'duplicate';
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
