import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { ENTITY_STRATEGY } from '../sync/entities.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import { REWARD_COST_MAX, REWARD_NAME_MAX_LENGTH, RewardRedemptionSchema, RewardSchema } from './reward.js';

const T0 = 1_760_000_000_000;

const reward = (overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  hlc: encodeHlc({ wall: T0, counter: 0, node: newId() }),
  updatedAt: T0,
  deletedAt: null,
  name: 'Ver un capítulo',
  cost: 50,
  ...overrides,
});

const redemption = (overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  rewardId: newId(),
  name: 'Ver un capítulo',
  cost: 50,
  redeemedAt: T0,
  deviceId: newId(),
  ...overrides,
});

describe('premios y canjes (UX10)', () => {
  it('SYNC §1: el premio es LWW y el canje es solo de inserción', () => {
    expect(ENTITY_STRATEGY.reward).toBe('lww');
    expect(ENTITY_STRATEGY.rewardRedemption).toBe('append');
    expect(SYNC_ROW_SCHEMAS.reward).toBe(RewardSchema);
    expect(SYNC_ROW_SCHEMAS.rewardRedemption).toBe(RewardRedemptionSchema);
  });

  it('el nombre y el costo los define ella, dentro de límites técnicos', () => {
    expect(RewardSchema.safeParse(reward()).success).toBe(true);
    expect(RewardSchema.parse(reward({ name: '  Un postre  ' })).name).toBe('Un postre');
    expect(RewardSchema.safeParse(reward({ name: '   ' })).success).toBe(false);
    expect(RewardSchema.safeParse(reward({ name: 'x'.repeat(REWARD_NAME_MAX_LENGTH + 1) })).success).toBe(
      false,
    );
    expect(RewardSchema.safeParse(reward({ cost: 1 })).success).toBe(true);
    expect(RewardSchema.safeParse(reward({ cost: REWARD_COST_MAX })).success).toBe(true);
    expect(RewardSchema.safeParse(reward({ cost: 0 })).success).toBe(false);
    expect(RewardSchema.safeParse(reward({ cost: REWARD_COST_MAX + 1 })).success).toBe(false);
    expect(RewardSchema.safeParse(reward({ cost: 2.5 })).success).toBe(false);
    expect(RewardSchema.safeParse(reward({ stock: 3 })).success).toBe(false);
  });

  it('el canje guarda una foto del nombre y el costo; sin campos de más', () => {
    expect(RewardRedemptionSchema.safeParse(redemption()).success).toBe(true);
    expect(RewardRedemptionSchema.safeParse(redemption({ cost: 0 })).success).toBe(false);
    expect(RewardRedemptionSchema.safeParse(redemption({ name: '' })).success).toBe(false);
    expect(RewardRedemptionSchema.safeParse(redemption({ hlc: reward().hlc })).success).toBe(false);
  });
});
