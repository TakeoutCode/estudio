import { decodeHlc, newId, type PushResponse, PushResponseSchema, SERVER_NODE } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hlcAt, type IntegrationApp, signIn, startIntegrationApp } from '../../test/integration-app.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000a1';
const LAPTOP = '0192f1a0-0000-7000-8000-0000000000b2';

describe('temporizador por sync (SYNC SY7, ADR-006)', () => {
  let server: IntegrationApp;
  let user: { token: string };
  let now: number;

  const push = async (mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ deviceId: PHONE, mutations })
      .expect(200);
    return PushResponseSchema.parse(res.body);
  };
  const rows = async (entity: string) => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: Record<string, unknown> }[] };
    return body.changes.filter((c) => c.entity === entity).map((c) => c.row);
  };
  const session = (wall: number, node: string, overrides: Record<string, unknown> = {}) => ({
    id: newId(),
    hlc: hlcAt(wall, node),
    updatedAt: wall,
    deletedAt: null,
    state: 'focus',
    mode: 'flexible',
    startedAt: wall,
    pausedAt: null,
    pausedMs: 0,
    blockIndex: 0,
    completedBlocks: 0,
    plannedMs: 25 * 60_000,
    extendedThisBlock: false,
    ownerDeviceId: node,
    lastSeenAt: wall,
    endedReason: null,
    ...overrides,
  });
  const upsert = (row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity: 'timerSession',
    row,
  });
  const block = (timerSessionId: string, overrides: Record<string, unknown> = {}) => ({
    mutationId: newId(),
    op: 'append',
    entity: 'timerBlockLog',
    row: {
      id: newId(),
      timerSessionId,
      deviceId: PHONE,
      kind: 'focus',
      blockIndex: 0,
      mode: 'flexible',
      startedAt: now - 25 * 60_000,
      endedAt: now,
      plannedMs: 25 * 60_000,
      activeMs: 25 * 60_000,
      outcome: 'completed',
      ...overrides,
    },
  });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'temporizador@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('SY-T11: con dos temporizadores activos queda el de HLC mayor; el otro termina superseded', async () => {
    const phone = session(now, PHONE);
    const laptop = session(now + 1_000, LAPTOP);
    expect((await push([upsert(phone)])).results[0]?.status).toBe('applied');
    expect((await push([upsert(laptop)])).results[0]?.status).toBe('applied');

    const all = await rows('timerSession');
    expect(all.find((s) => s.id === laptop.id)).toMatchObject({ state: 'focus', endedReason: null });
    const closed = all.find((s) => s.id === phone.id);
    expect(closed).toMatchObject({ state: 'ended', endedReason: 'superseded', startedAt: null });
    // El cierre lo firma el servidor con un HLC que le gana al del teléfono.
    expect(decodeHlc(String(closed?.hlc)).node).toBe(SERVER_NODE);

    // Un tercero con el reloj atrasado llega después pero pierde: se cierra él.
    const late = session(now - 60_000, PHONE);
    await push([upsert(late)]);
    const after = await rows('timerSession');
    expect(after.find((s) => s.id === late.id)).toMatchObject({ state: 'ended', endedReason: 'superseded' });
    expect(after.find((s) => s.id === laptop.id)).toMatchObject({ state: 'focus' });
  });

  it('una sesión en reposo no cierra la activa', async () => {
    const active = session(now + 10_000, LAPTOP);
    await push([upsert(active)]);
    await push([upsert(session(now + 20_000, PHONE, { state: 'idle', startedAt: null, plannedMs: 0 }))]);
    expect((await rows('timerSession')).find((s) => s.id === active.id)).toMatchObject({ state: 'focus' });
  });

  it('BE2 y SYNC §1: un bloque se refiere a una sesión de ella, llega una vez y no se modifica', async () => {
    const own = session(now + 30_000, PHONE);
    await push([upsert(own)]);
    const orphan = block(newId());
    const mine = block(own.id);
    const results = (await push([orphan, mine])).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'not_found'],
      ['applied', undefined],
    ]);
    // Reenviado (p. ej. tras perder la respuesta): no se duplica (SY-T3).
    expect((await push([mine])).results[0]?.status).toBe('duplicate');
    // Un cliente anterior no envía `extended` (contrato 3): queda en false.
    expect((await rows('timerBlockLog')).find((b) => b.id === mine.row.id)).toEqual({
      ...mine.row,
      extended: false,
    });
    await expect(
      server.prisma
        .$executeRaw`UPDATE "timer_block_log" SET "outcome" = 'manual' WHERE "id" = ${mine.row.id}::uuid`,
    ).rejects.toThrow(/append_only_table/);
  });

  it('§5: un bloque extendido llega y vuelve con `extended: true`', async () => {
    const own = session(now + 40_000, PHONE);
    await push([upsert(own)]);
    const extended = block(own.id, { plannedMs: 30 * 60_000, activeMs: 30 * 60_000, extended: true });
    expect((await push([extended])).results[0]?.status).toBe('applied');
    expect((await rows('timerBlockLog')).find((b) => b.id === extended.row.id)).toEqual(extended.row);
  });
});
