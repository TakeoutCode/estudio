import { type ApiErrorCode, MAX_HLC_DRIFT_MS, type SelfExplanation } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { DecksRepository } from '../decks/decks.repository.js';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/**
 * LD5: "Explícalo con tus palabras" y "Explícaselo a alguien" (STUDY-METHODS §1). No es un
 * repaso (R15): no toca ReviewLog ni FSRS.
 */
@Injectable()
@SyncHandler('selfExplanation')
export class SelfExplanationSyncHandler implements EntitySyncHandler<'selfExplanation'> {
  readonly entity = 'selfExplanation';
  readonly table = 'self_explanation';

  constructor(
    private readonly repo: StudyRepository,
    private readonly decks: DecksRepository,
  ) {}

  check(_userId: string, row: SelfExplanation, now: number): ApiErrorCode | null {
    return row.writtenAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  async refs(userId: string, row: SelfExplanation): Promise<ApiErrorCode | null> {
    return (await this.decks.owns('topic', userId, row.topicId)) ? null : 'not_found';
  }

  apply(userId: string, row: SelfExplanation): Promise<ApplyStatus> {
    return this.repo.upsertSelfExplanationLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      topicId: d.topic_id,
      kind: d.kind,
      text: d.text,
      gaps: d.gaps,
      writtenAt: dbNumber(d.written_at),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
