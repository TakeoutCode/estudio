import { z } from 'zod';

/**
 * Estrategia de sincronización de cada entidad (SYNC SY1). Cliente y handlers del
 * servidor leen este mismo mapa; una entidad nueva sin entrada aquí no se sincroniza.
 * Las proyecciones (cardStates, XP, métricas) no viajan: se recalculan con srs (ARC5).
 */
export const ENTITY_STRATEGY = {
  deck: 'lww',
  topic: 'lww',
  tag: 'lww',
  note: 'lww',
  card: 'lww',
  exam: 'lww',
  contrastGroup: 'lww',
  mediaAsset: 'lww',
  userSettings: 'lww',
  studySession: 'lww',
  timerSession: 'lww',
  selfExplanation: 'lww',
  aiDraft: 'lww',
  reward: 'lww',
  sleepLog: 'lww',
  reviewLog: 'append',
  timerBlockLog: 'append',
  rewardRedemption: 'append',
  aiFeedback: 'append',
} as const satisfies Record<string, 'lww' | 'append'>;

export type EntityName = keyof typeof ENTITY_STRATEGY;
export type SyncStrategy = (typeof ENTITY_STRATEGY)[EntityName];

const entityNames = Object.keys(ENTITY_STRATEGY) as [EntityName, ...EntityName[]];
export const EntityNameSchema = z.enum(entityNames);

/** Operación que corresponde a cada estrategia: LWW → upsert (borrar = escribir deletedAt). */
export const opForEntity = (entity: EntityName): 'upsert' | 'append' =>
  ENTITY_STRATEGY[entity] === 'lww' ? 'upsert' : 'append';
