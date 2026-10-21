import type { z } from 'zod';
import { ContrastGroupSchema } from '../domain/contrast.js';
import { DeckSchema } from '../domain/deck.js';
import { ExamSchema } from '../domain/exam.js';
import { MediaAssetSchema } from '../domain/media.js';
import { CardSchema, NoteSchema } from '../domain/note.js';
import { ReviewLogSchema } from '../domain/review.js';
import { StudySessionSchema } from '../domain/study-session.js';
import { SelfExplanationSchema, TopicSchema } from '../domain/topic.js';
import { TimerBlockLogSchema, TimerSessionSchema } from '../domain/timer.js';
import { UserSettingsSchema } from '../domain/user-settings.js';
import type { EntityName } from './entities.js';

/**
 * Esquema de fila de cada entidad que ya se sincroniza. El cliente valida con esto lo que
 * llega por pull y el servidor lo que llega por push (AGENTS AG2). Una entidad de
 * ENTITY_STRATEGY sin esquema aquí todavía no viaja.
 */
export const SYNC_ROW_SCHEMAS = {
  deck: DeckSchema,
  topic: TopicSchema,
  note: NoteSchema,
  card: CardSchema,
  exam: ExamSchema,
  contrastGroup: ContrastGroupSchema,
  mediaAsset: MediaAssetSchema,
  userSettings: UserSettingsSchema,
  selfExplanation: SelfExplanationSchema,
  studySession: StudySessionSchema,
  timerSession: TimerSessionSchema,
  reviewLog: ReviewLogSchema,
  timerBlockLog: TimerBlockLogSchema,
} as const satisfies Partial<Record<EntityName, z.ZodType>>;

export type SyncedEntity = keyof typeof SYNC_ROW_SCHEMAS;
export type SyncedRow<E extends SyncedEntity> = z.output<(typeof SYNC_ROW_SCHEMAS)[E]>;

export const isSyncedEntity = (entity: EntityName): entity is SyncedEntity => entity in SYNC_ROW_SCHEMAS;
