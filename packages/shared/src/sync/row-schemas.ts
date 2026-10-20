import type { z } from 'zod';
import { DeckSchema } from '../domain/deck.js';
import { ReviewLogSchema } from '../domain/review.js';
import { UserSettingsSchema } from '../domain/user-settings.js';
import type { EntityName } from './entities.js';

/**
 * Esquema de fila de cada entidad que ya se sincroniza. El cliente valida con esto lo que
 * llega por pull y el servidor lo que llega por push (AGENTS AG2). Una entidad de
 * ENTITY_STRATEGY sin esquema aquí todavía no viaja.
 */
export const SYNC_ROW_SCHEMAS = {
  deck: DeckSchema,
  userSettings: UserSettingsSchema,
  reviewLog: ReviewLogSchema,
} as const satisfies Partial<Record<EntityName, z.ZodType>>;

export type SyncedEntity = keyof typeof SYNC_ROW_SCHEMAS;
export type SyncedRow<E extends SyncedEntity> = z.output<(typeof SYNC_ROW_SCHEMAS)[E]>;

export const isSyncedEntity = (entity: EntityName): entity is SyncedEntity => entity in SYNC_ROW_SCHEMAS;
