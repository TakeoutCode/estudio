import type { ApiErrorCode, Exam } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { DecksRepository } from '../decks/decks.repository.js';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { ExamsRepository } from './exams.repository.js';

/** R11, LD11: examen con su fecha y alcance (LWW). */
@Injectable()
@SyncHandler('exam')
export class ExamSyncHandler implements EntitySyncHandler<'exam'> {
  readonly entity = 'exam';
  readonly table = 'exam';

  constructor(
    private readonly repo: ExamsRepository,
    private readonly decks: DecksRepository,
  ) {}

  check(): null {
    return null;
  }

  /** BE2: cada tema del alcance es de ella (aunque esté borrado). */
  async refs(userId: string, row: Exam): Promise<ApiErrorCode | null> {
    for (const topicId of row.topicIds) {
      if (!(await this.decks.owns('topic', userId, topicId))) return 'not_found';
    }
    return null;
  }

  apply(userId: string, row: Exam): Promise<ApplyStatus> {
    return this.repo.upsertExamLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      title: d.title,
      date: dbNumber(d.date),
      topicIds: d.topic_ids,
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
