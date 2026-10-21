import {
  type GamificationConfig,
  newId,
  type Reward,
  type RewardRedemption,
  RewardRedemptionSchema,
  RewardSchema,
} from '@estudio/shared';
import { coinBalance } from '@estudio/srs';
import { deviceId, hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { readGamificationConfig } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { updateGamificationConfig } from '@/features/settings';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/** UX10: su respuesta en el onboarding (o después, en Ajustes). Hasta entonces queda apagada. */
export function answerGamification(
  enabled: boolean,
  options: CommandOptions = {},
): Promise<GamificationConfig> {
  return updateGamificationConfig((config) => ({ ...config, enabled }), options);
}

/** Crea o edita un premio: el nombre y el costo los define ella (UX10). */
export async function saveReward(
  draft: { readonly id?: string; readonly name: string; readonly cost: number },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Reward> {
  const saved = await database.transaction(
    'rw',
    [database.rewards, database.outbox, database.meta],
    async () => {
      const hlc = await nextHlc(database, now);
      const row = RewardSchema.parse({
        id: draft.id ?? newId(),
        name: draft.name,
        cost: draft.cost,
        hlc,
        updatedAt: hlcWall(hlc),
        deletedAt: null,
      });
      await writeAndQueue(database, 'reward', row, now);
      return row;
    },
  );
  syncScheduler.poke();
  return saved;
}

/** Borrar un premio no devuelve monedas: los canjes guardan su foto (SYNC §1). */
export async function deleteReward(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<void> {
  await database.transaction('rw', [database.rewards, database.outbox, database.meta], async () => {
    const current = await database.rewards.get(id);
    if (current?.deletedAt !== null) return;
    const hlc = await nextHlc(database, now);
    await writeAndQueue(
      database,
      'reward',
      { ...current, hlc, updatedAt: hlcWall(hlc), deletedAt: now },
      now,
    );
  });
  syncScheduler.poke();
}

/**
 * UX10: canjear un premio es un RewardRedemption de solo inserción. El saldo se recalcula aquí,
 * con el conteo de repasos (sin recorrer el log), para no canjear dos veces con un doble toque.
 */
export async function redeemReward(
  rewardId: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<RewardRedemption> {
  const saved = await database.transaction(
    'rw',
    [
      database.rewards,
      database.rewardRedemptions,
      database.reviewLogs,
      database.userSettings,
      database.outbox,
      database.meta,
    ],
    async () => {
      const config = await readGamificationConfig(database);
      if (config.enabled !== true) throw new Error('gamification_off');
      const reward = await database.rewards.get(rewardId);
      if (reward?.deletedAt !== null) throw new Error('reward_not_found');
      const { balance } = coinBalance(
        await database.reviewLogs.count(),
        await database.rewardRedemptions.toArray(),
        config,
      );
      if (balance < reward.cost) throw new Error('not_enough_coins');
      const row = RewardRedemptionSchema.parse({
        id: newId(),
        rewardId,
        name: reward.name,
        cost: reward.cost,
        redeemedAt: now,
        deviceId: await deviceId(database),
      });
      await writeAndQueue(database, 'rewardRedemption', row, now);
      return row;
    },
  );
  syncScheduler.poke();
  return saved;
}
