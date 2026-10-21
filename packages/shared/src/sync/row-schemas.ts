import type { z } from 'zod';
import { AiDraftSchema } from '../domain/ai.js';
import { ContrastGroupSchema } from '../domain/contrast.js';
import { DeckSchema } from '../domain/deck.js';
import { ExamSchema } from '../domain/exam.js';
import { MediaAssetSchema } from '../domain/media.js';
import { CardSchema, NoteSchema } from '../domain/note.js';
import { ReviewLogSchema } from '../domain/review.js';
import { RewardRedemptionSchema, RewardSchema } from '../domain/reward.js';
import { SleepLogSchema } from '../domain/sleep.js';
import { TagSchema } from '../domain/tag.js';
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
  tag: TagSchema,
  note: NoteSchema,
  card: CardSchema,
  exam: ExamSchema,
  contrastGroup: ContrastGroupSchema,
  mediaAsset: MediaAssetSchema,
  userSettings: UserSettingsSchema,
  selfExplanation: SelfExplanationSchema,
  studySession: StudySessionSchema,
  timerSession: TimerSessionSchema,
  sleepLog: SleepLogSchema,
  reward: RewardSchema,
  aiDraft: AiDraftSchema,
  reviewLog: ReviewLogSchema,
  timerBlockLog: TimerBlockLogSchema,
  rewardRedemption: RewardRedemptionSchema,
} as const satisfies Partial<Record<EntityName, z.ZodType>>;

export type SyncedEntity = keyof typeof SYNC_ROW_SCHEMAS;
export type SyncedRow<E extends SyncedEntity> = z.output<(typeof SYNC_ROW_SCHEMAS)[E]>;

export const isSyncedEntity = (entity: EntityName): entity is SyncedEntity => entity in SYNC_ROW_SCHEMAS;
