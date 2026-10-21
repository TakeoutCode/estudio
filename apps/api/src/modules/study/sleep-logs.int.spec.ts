import { newId, type PushResponse, PushResponseSchema, sleepLogIdFor } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hlcAt, type IntegrationApp, signIn, startIntegrationApp } from '../../test/integration-app.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000b1';
const LAPTOP = '0192f1a0-0000-7000-8000-0000000000b2';

describe('registro de sueño por sync (§5, SYNC §1)', () => {
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
  const upsert = (row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity: 'sleepLog',
    row,
  });
  const night = (
    as: { userId: string },
    date: string,
    quality: number,
    { wall = now, node = PHONE }: { wall?: number; node?: string } = {},
  ) => ({
    id: sleepLogIdFor(as.userId, date),
    date,
    quality,
    loggedAt: wall,
    hlc: hlcAt(wall, node),
    updatedAt: wall,
    deletedAt: null,
  });
  const pulled = async (as: { token: string }) => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${as.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: unknown }[] };
    return body.changes.filter((c) => c.entity === 'sleepLog').map((c) => c.row);
  };

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'sueno-a@ejemplo.mx');
    other = await signIn(server, 'sueno-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('una fila por noche: el id sale de la cuenta y la fecha; otro id o calidad fuera de 1-5 se rechazan', async () => {
    const ok = night(user, '2026-10-20', 4);
    const results = (
      await push(user, [
        upsert(ok),
        upsert({ ...night(user, '2026-10-19', 3), id: newId() }),
        upsert(night(user, '2026-10-18', 6)),
        upsert({ ...night(user, '2026-10-17', 2), loggedAt: now + 2 * 86_400_000 }),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['rejected', 'validation_failed'],
      ['rejected', 'validation_failed'],
      ['rejected', 'validation_failed'],
    ]);
    expect(await pulled(user)).toEqual([ok]);
  });

  it('dos dispositivos que anotan la misma noche convergen por LWW; otra cuenta no la pisa', async () => {
    const date = '2026-10-21';
    const fromPhone = night(user, date, 2);
    const fromLaptop = night(user, date, 5, { wall: now + 60_000, node: LAPTOP });
    expect((await push(user, [upsert(fromLaptop), upsert(fromPhone)])).results.map((r) => r.status)).toEqual([
      'applied',
      'stale',
    ]);
    // La otra cuenta no puede escribir con el id de ella: no es el de su propia noche.
    const intruder = { ...night(other, date, 1, { wall: now + 120_000 }), id: fromLaptop.id };
    expect((await push(other, [upsert(intruder)])).results[0]).toMatchObject({
      status: 'rejected',
      code: 'validation_failed',
    });
    expect((await pulled(user)).filter((row) => (row as { date: string }).date === date)).toEqual([
      fromLaptop,
    ]);
    expect(await pulled(other)).toEqual([]);
  });
});
