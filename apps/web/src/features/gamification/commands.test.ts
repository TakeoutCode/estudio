import { MutationSchema, newId, type ReviewLog } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { readGamificationConfig } from '@/db/settings';
import { updateGamificationConfig } from '@/features/settings';
import { answerGamification, deleteReward, redeemReward, saveReward } from './commands';
import { loadGamificationInput, readRewards } from './queries';

const ME = '0192f1a0-0000-7000-8000-00000000c0de';
const T0 = Date.UTC(2026, 9, 20, 15);

const review = (reviewedAt: number): ReviewLog => ({
  id: newId(),
  cardId: newId(),
  cardKind: 'basic',
  reviewedAt,
  rating: 1,
  durationMs: 3000,
  type: 'review',
  confidence: null,
  sessionId: newId(),
  deviceId: newId(),
});

/** Con los valores iniciales, 10 XP por repaso y 0.1 monedas por XP: una moneda por repaso. */
const answered = (count: number) =>
  db.reviewLogs.bulkAdd(Array.from({ length: count }, (_, i) => review(T0 - (i + 1) * 60_000)));

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: ME });
});

describe('gamificación: respuesta del onboarding (UX10)', () => {
  it('queda apagada (null) hasta que ella responda; su respuesta viaja con UserSettings', async () => {
    expect((await readGamificationConfig(db)).enabled).toBeNull();
    expect(await loadGamificationInput(db, T0)).toBeNull(); // apagada: no se calcula nada

    await answerGamification(true, { now: T0 });
    expect((await readGamificationConfig(db)).enabled).toBe(true);
    const [entry] = await db.outbox.toArray();
    expect(MutationSchema.parse(entry)).toMatchObject({
      op: 'upsert',
      entity: 'userSettings',
      row: { section: 'gamification', data: { enabled: true } },
    });

    await answerGamification(false, { now: T0 + 1 });
    expect((await readGamificationConfig(db)).enabled).toBe(false);
  });
});

describe('premios y canjes (UX10)', () => {
  beforeEach(async () => {
    await answerGamification(true, { now: T0 });
  });

  it('FE3: crear, editar y borrar un premio son escrituras LWW con outbox', async () => {
    const reward = await saveReward({ name: '  Ver un capítulo ', cost: 40 }, { now: T0 });
    expect(reward).toMatchObject({ name: 'Ver un capítulo', cost: 40, deletedAt: null });
    const edited = await saveReward({ id: reward.id, name: 'Un postre', cost: 25 }, { now: T0 + 1 });
    expect(edited.hlc > reward.hlc).toBe(true);
    expect(await readRewards(db)).toEqual([edited]);

    await deleteReward(reward.id, { now: T0 + 2 });
    expect(await readRewards(db)).toEqual([]);
    const ops = (await db.outbox.toArray()).filter((e) => e.entity === 'reward');
    expect(ops.map((e) => [e.op, (e.row as { deletedAt: number | null }).deletedAt])).toEqual([
      ['upsert', null],
      ['upsert', null],
      ['upsert', T0 + 2],
    ]);
    await expect(saveReward({ name: '', cost: 10 })).rejects.toThrow();
    await expect(saveReward({ name: 'Algo', cost: 0 })).rejects.toThrow();
  });

  it('canjear es solo inserción, guarda la foto del premio y descuenta del saldo calculado', async () => {
    await answered(50);
    const reward = await saveReward({ name: 'Ver un capítulo', cost: 30 }, { now: T0 });
    const redemption = await redeemReward(reward.id, { now: T0 + 5 });
    expect(redemption).toMatchObject({
      rewardId: reward.id,
      name: 'Ver un capítulo',
      cost: 30,
      redeemedAt: T0 + 5,
    });
    const [entry] = (await db.outbox.toArray()).filter((e) => e.entity === 'rewardRedemption');
    expect(MutationSchema.parse(entry)).toMatchObject({ op: 'append', row: redemption });

    // Quedan 20 monedas: un segundo canje de 30 no alcanza, ni con un doble toque.
    await expect(redeemReward(reward.id, { now: T0 + 6 })).rejects.toThrow('not_enough_coins');
    expect(await db.rewardRedemptions.count()).toBe(1);

    // Editar o borrar el premio no cambia lo ya canjeado.
    await saveReward({ id: reward.id, name: 'Otro', cost: 1 }, { now: T0 + 7 });
    await deleteReward(reward.id, { now: T0 + 8 });
    expect(await db.rewardRedemptions.toArray()).toEqual([redemption]);
    await expect(redeemReward(reward.id, { now: T0 + 9 })).rejects.toThrow('reward_not_found');
  });

  it('con la gamificación apagada no se canjea', async () => {
    await answered(50);
    const reward = await saveReward({ name: 'Ver un capítulo', cost: 10 }, { now: T0 });
    await updateGamificationConfig((c) => ({ ...c, enabled: false }));
    await expect(redeemReward(reward.id, { now: T0 + 1 })).rejects.toThrow('gamification_off');
  });
});
