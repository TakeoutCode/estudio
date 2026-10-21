import { newId, type PushResponse, PushResponseSchema } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hlcAt, type IntegrationApp, signIn, startIntegrationApp } from '../../test/integration-app.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000c1';
const LAPTOP = '0192f1a0-0000-7000-8000-0000000000c2';

describe('premios y canjes por sync (UX10, SYNC §1)', () => {
  let server: IntegrationApp;
  let user: { token: string; userId: string };
  let other: { token: string; userId: string };
  let now: number;

  const push = async (as: { token: string }, mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${as.token}`)
      .send({ deviceId: PHONE, mutations })
      .expect(200);
    return PushResponseSchema.parse(res.body);
  };
  const pulled = async (as: { token: string }, entity: string) => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${as.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: Record<string, unknown> }[] };
    return body.changes.filter((c) => c.entity === entity).map((c) => c.row);
  };
  const upsert = (row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity: 'reward',
    row,
  });
  const append = (row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'append',
    entity: 'rewardRedemption',
    row,
  });
  const reward = (overrides: Record<string, unknown> = {}, { wall = now, node = PHONE } = {}) => ({
    id: newId(),
    name: 'Ver un capítulo',
    cost: 40,
    hlc: hlcAt(wall, node),
    updatedAt: wall,
    deletedAt: null,
    ...overrides,
  });
  const redemption = (rewardId: string, overrides: Record<string, unknown> = {}) => ({
    id: newId(),
    rewardId,
    name: 'Ver un capítulo',
    cost: 40,
    redeemedAt: now,
    deviceId: PHONE,
    ...overrides,
  });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'premios-a@ejemplo.mx');
    other = await signIn(server, 'premios-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('el premio es LWW: gana la edición de HLC mayor y otra cuenta no lo pisa', async () => {
    const first = reward();
    const edited = { ...first, cost: 60, hlc: hlcAt(now + 60_000, LAPTOP), updatedAt: now + 60_000 };
    const results = (await push(user, [upsert(edited), upsert(first), upsert(reward({ cost: 0 }))])).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['stale', undefined],
      ['rejected', 'validation_failed'],
    ]);
    const intruder = { ...edited, name: 'Otro', hlc: hlcAt(now + 120_000, LAPTOP), updatedAt: now + 120_000 };
    expect((await push(other, [upsert(intruder)])).results[0]?.status).toBe('stale');
    expect(await pulled(user, 'reward')).toEqual([edited]);
    expect(await pulled(other, 'reward')).toEqual([]);
  });

  it('el canje es solo de inserción, apunta a un premio suyo (aunque esté borrado) y no se repite', async () => {
    const mine = reward();
    const theirs = reward();
    await push(other, [upsert(theirs)]);
    await push(user, [upsert(mine)]);
    await push(user, [
      upsert({ ...mine, deletedAt: now + 1, hlc: hlcAt(now + 1, PHONE), updatedAt: now + 1 }),
    ]);

    const ok = redemption(mine.id);
    const results = (
      await push(user, [
        append(redemption(theirs.id)),
        append(ok),
        append(redemption(mine.id, { redeemedAt: now + 2 * 86_400_000 })),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'not_found'],
      ['applied', undefined],
      ['rejected', 'validation_failed'],
    ]);
    expect((await push(user, [append(ok)])).results[0]?.status).toBe('duplicate');
    expect(await pulled(user, 'rewardRedemption')).toEqual([ok]);
    await expect(
      server.prisma.$executeRaw`UPDATE "reward_redemption" SET "cost" = 1 WHERE "id" = ${ok.id}::uuid`,
    ).rejects.toThrow(/append_only_table/);
    await expect(
      server.prisma.$executeRaw`DELETE FROM "reward_redemption" WHERE "id" = ${ok.id}::uuid`,
    ).rejects.toThrow(/append_only_table/);
  });
});
