import { type ApiErrorCode, MAX_HLC_DRIFT_MS, type StudySession } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { DecksRepository } from '../decks/decks.repository.js';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/**
 * P7, LD13: un simulacro (StudySession con `mode: 'exam'`, BACKEND §1). Sus respuestas viajan
 * por LWW; las calificaciones que cuentan para FSRS van aparte, como ReviewLog `exam`.
 */
@Injectable()
@SyncHandler('studySession')
export class StudySessionSyncHandler implements EntitySyncHandler<'studySession'> {
  readonly entity = 'studySession';
  readonly table = 'study_session';

  constructor(
    private readonly repo: StudyRepository,
    private readonly decks: DecksRepository,
  ) {}

  check(_userId: string, row: StudySession, now: number): ApiErrorCode | null {
    return row.startedAt - now > MAX_HLC_DRIFT_MS ? 'validation_failed' : null;
  }

  /** BE2: el examen y cada tarjeta del simulacro son de ella. */
  async refs(userId: string, row: StudySession): Promise<ApiErrorCode | null> {
    if (!(await this.repo.ownsExam(userId, row.examId))) return 'not_found';
    const cards = row.items.map((item) => item.cardId);
    return (await this.decks.ownsAll('card', userId, cards)) ? null : 'not_found';
  }

  apply(userId: string, row: StudySession): Promise<ApplyStatus> {
    return this.repo.upsertStudySessionLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      mode: d.mode,
      examId: d.exam_id,
      feedbackTiming: d.feedback_timing,
      items: d.items,
      startedAt: dbNumber(d.started_at),
      finishedAt: dbNumberOrNull(d.finished_at),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
