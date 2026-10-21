import type { AiDraft, ApiErrorCode } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { AiRepository } from './ai.repository.js';

/** LD16: un borrador de la IA que ella revisa (LWW). */
@Injectable()
@SyncHandler('aiDraft')
export class AiDraftSyncHandler implements EntitySyncHandler<'aiDraft'> {
  readonly entity = 'aiDraft';
  readonly table = 'ai_draft';

  constructor(private readonly repo: AiRepository) {}

  check(): null {
    return null;
  }

  /** BE2: su mazo y, si ya lo aceptó, su nota son de ella (aunque estén borrados). */
  async refs(userId: string, row: AiDraft): Promise<ApiErrorCode | null> {
    if (!(await this.repo.owns('deck', userId, row.deckId))) return 'not_found';
    return row.noteId === null || (await this.repo.owns('note', userId, row.noteId)) ? null : 'not_found';
  }

  apply(userId: string, row: AiDraft): Promise<ApplyStatus> {
    return this.repo.upsertDraftLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      kind: d.kind,
      deckId: d.deck_id,
      draft: d.draft,
      supported: d.supported,
      edited: d.edited,
      status: d.status,
      noteId: d.note_id,
      createdAt: dbNumber(d.created_at),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
