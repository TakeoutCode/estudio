import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

// Premios de la tienda (UI-UX UX10, diseño · sin evidencia: STUDY-METHODS §6 no investigó la
// gamificación). Los premios y sus costos los define ella; canjear uno es un RewardRedemption
// de solo inserción y el saldo de monedas se calcula, no se guarda (SYNC §1).

export const REWARD_NAME_MAX_LENGTH = 80;
/** Límite técnico, no de estudio: el costo lo elige ella dentro de este rango. */
export const REWARD_COST_MAX = 9_999;

const RewardNameSchema = z.string().trim().min(1).max(REWARD_NAME_MAX_LENGTH);
const RewardCostSchema = z.number().int().min(1).max(REWARD_COST_MAX);

export const RewardSchema = SyncMetaSchema.extend({
  name: RewardNameSchema,
  /** Monedas que cuesta canjearlo. */
  cost: RewardCostSchema,
}).strict();
export type Reward = z.infer<typeof RewardSchema>;

/**
 * Un canje (solo inserción, SYNC §1). Guarda una foto del nombre y el costo, porque el premio
 * se puede editar o borrar después y el saldo no debe cambiar por eso.
 */
export const RewardRedemptionSchema = z
  .object({
    id: z.uuid(),
    rewardId: z.uuid(),
    name: RewardNameSchema,
    cost: RewardCostSchema,
    redeemedAt: z.number().int().nonnegative(),
    deviceId: z.uuid(),
  })
  .strict();
export type RewardRedemption = z.infer<typeof RewardRedemptionSchema>;
