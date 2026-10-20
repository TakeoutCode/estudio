import {
  MAX_HLC_DRIFT_MS,
  newId,
  type PullResponse,
  PullResponseSchema,
  type PushResponse,
  PushResponseSchema,
  settingsRowId,
} from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deckRow,
  hlcAt,
  type IntegrationApp,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';
import { syncMetaColumns, upsertLwwSql } from './sql.js';

const NODE = '0192f1a0-0000-7000-8000-00000000000a';

describe('sync contra Postgres real (SYNC.md)', () => {
  let server: IntegrationApp;
  let a: { token: string; userId: string };
  let b: { token: string; userId: string };
  let now: number;

  const push = async (token: string, mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: NODE, mutations })
      .expect(200);
    return PushResponseSchema.parse(res.body);
  };
  const pull = async (token: string, cursor = '0', limit = 500): Promise<PullResponse> => {
    const res = await server
      .api()
      .get(`/sync/pull?cursor=${cursor}&limit=${limit}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return PullResponseSchema.parse(res.body);
  };
  const upsert = (row: Record<string, unknown>, entity = 'deck') => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });
  const append = (row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'append',
    entity: 'reviewLog',
    row,
  });
  const reviewLog = (overrides: Record<string, unknown> = {}) => ({
    id: newId(),
    cardId: newId(),
    cardKind: 'basic',
    reviewedAt: now,
    rating: 3,
    durationMs: 4200,
    type: 'review',
    confidence: null,
    sessionId: newId(),
    deviceId: NODE,
    ...overrides,
  });
  const allChanges = async (token: string) => (await pull(token)).changes;

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    a = await signIn(server, 'sync-a@ejemplo.mx');
    b = await signIn(server, 'sync-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('SY-T3: reenviar la misma mutación responde duplicate y no duplica filas', async () => {
    const deck = deckRow(now, NODE);
    const mutation = upsert(deck);
    expect((await push(a.token, [mutation])).results[0]?.status).toBe('applied');
    expect((await push(a.token, [mutation])).results[0]?.status).toBe('duplicate');
    const rows = await server.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "deck" WHERE "id" = ${deck.id}::uuid`;
    expect(rows[0]?.n).toBe(1n);
  });

  it('SY-T6: HLC viejo → stale; nuevo → gana; borrar y luego editar revive', async () => {
    const deck = deckRow(now, NODE);
    await push(a.token, [upsert(deck)]);

    const older = { ...deck, name: 'Viejo', hlc: hlcAt(now - 1000, NODE), updatedAt: now - 1000 };
    expect((await push(a.token, [upsert(older)])).results[0]?.status).toBe('stale');

    const newer = {
      ...deck,
      name: 'Huesos del carpo y metacarpo',
      hlc: hlcAt(now + 1, NODE),
      updatedAt: now + 1,
    };
    expect((await push(a.token, [upsert(newer)])).results[0]?.status).toBe('applied');

    const deleted = { ...newer, hlc: hlcAt(now + 2, NODE), updatedAt: now + 2, deletedAt: now + 2 };
    await push(a.token, [upsert(deleted)]);
    let row = (await allChanges(a.token)).find((c) => c.row.id === deck.id)?.row;
    expect(row).toMatchObject({ deletedAt: now + 2 });

    const revived = {
      ...deleted,
      name: 'De vuelta',
      hlc: hlcAt(now + 3, NODE),
      updatedAt: now + 3,
      deletedAt: null,
    };
    expect((await push(a.token, [upsert(revived)])).results[0]?.status).toBe('applied');
    row = (await allChanges(a.token)).find((c) => c.row.id === deck.id)?.row;
    expect(row).toMatchObject({ name: 'De vuelta', deletedAt: null });
  });

  it('el mismo HLC no vuelve a escribir: el push es idempotente aunque se purgue applied_mutation', async () => {
    const deck = deckRow(now, NODE);
    await push(a.token, [upsert(deck)]);
    expect((await push(a.token, [upsert(deck)])).results[0]?.status).toBe('stale');
  });

  it('aislamiento: otro usuario no puede pisar una fila ajena ni verla en su pull', async () => {
    const deck = deckRow(now, NODE);
    await push(a.token, [upsert(deck)]);
    const hijack = { ...deck, name: 'Ajeno', hlc: hlcAt(now + 10_000, NODE), updatedAt: now + 10_000 };
    expect((await push(b.token, [upsert(hijack)])).results[0]?.status).toBe('stale');
    expect((await allChanges(b.token)).some((c) => c.row.id === deck.id)).toBe(false);
    expect((await allChanges(a.token)).find((c) => c.row.id === deck.id)?.row).toMatchObject({
      name: 'Huesos del carpo',
    });
  });

  it('R3: el ReviewLog es solo de inserción, y Postgres lo hace cumplir', async () => {
    const log = reviewLog({ confidence: 2, answer: { typed: 'escafoides' } });
    expect((await push(a.token, [append(log)])).results[0]?.status).toBe('applied');
    // Otra mutación con el mismo log (p. ej. tras purgar applied_mutation): no se duplica.
    expect((await push(a.token, [append(log)])).results[0]?.status).toBe('duplicate');

    const pulled = (await allChanges(a.token)).find((c) => c.entity === 'reviewLog' && c.row.id === log.id);
    expect(pulled?.row).toEqual(log);

    await expect(
      server.prisma.$executeRaw`UPDATE "review_log" SET "rating" = 4 WHERE "id" = ${log.id}::uuid`,
    ).rejects.toThrow(/append_only_table/);
    await expect(
      server.prisma.$executeRaw`DELETE FROM "review_log" WHERE "id" = ${log.id}::uuid`,
    ).rejects.toThrow(/append_only_table/);
  });

  it('valida cada mutación: las inválidas se rechazan y las demás del lote se aplican', async () => {
    const good = deckRow(now, NODE);
    const results = (
      await push(a.token, [
        upsert(deckRow(now, NODE, { name: '' })), // esquema
        upsert(deckRow(now + MAX_HLC_DRIFT_MS + 60_000, NODE)), // reloj adelantado (SYNC §2)
        upsert({ ...deckRow(now, NODE), updatedAt: now - 5 }), // updatedAt ≠ reloj del HLC
        upsert(good),
        append(reviewLog({ reviewedAt: now + MAX_HLC_DRIFT_MS + 60_000 })),
      ])
    ).results;
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'applied', 'rejected']);
    expect(results[0]?.code).toBe('validation_failed');
  });

  it('una operación que no corresponde a la estrategia invalida todo el lote (422)', async () => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        deviceId: NODE,
        mutations: [{ mutationId: newId(), op: 'upsert', entity: 'reviewLog', row: {} }],
      })
      .expect(422);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
  });

  it('UserSettings: id determinista por sección y datos validados por su esquema', async () => {
    const id = settingsRowId(a.userId, 'study');
    const meta = { hlc: hlcAt(now, NODE), updatedAt: now, deletedAt: null };
    const valid = { id, section: 'study', data: { fsrs: { requestRetention: 0.85 } }, ...meta };
    const results = (
      await push(a.token, [
        upsert({ ...valid, id: newId() }, 'userSettings'),
        upsert({ ...valid, data: { fsrs: { requestRetention: 0.99 } } }, 'userSettings'),
        upsert(valid, 'userSettings'),
      ])
    ).results;
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'applied']);

    const row = (await allChanges(a.token)).find((c) => c.entity === 'userSettings')?.row as {
      data: { fsrs: { requestRetention: number }; planner: { newPerSessionMax: number } };
    };
    expect(row.data.fsrs.requestRetention).toBe(0.85);
    expect(row.data.planner.newPerSessionMax).toBe(10);
  });

  it('SY3: pagina por server_seq con hasMore y un cursor creciente', async () => {
    const fresh = await signIn(server, 'sync-c@ejemplo.mx');
    const decks = Array.from({ length: 5 }, () => deckRow(now, NODE));
    await push(
      fresh.token,
      decks.map((d) => upsert(d)),
    );

    const seen: string[] = [];
    let cursor = '0';
    let pages = 0;
    for (;;) {
      const page = await pull(fresh.token, cursor, 2);
      pages += 1;
      seen.push(...page.changes.map((c) => String(c.row.id)));
      expect(BigInt(page.cursor)).toBeGreaterThanOrEqual(BigInt(cursor));
      expect(page.serverNow).toBe(server.clock.now());
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(decks.map((d) => d.id));
    expect((await pull(fresh.token, cursor)).changes).toEqual([]);
  });

  it('SY-T9: un cursor anterior a la purga responde 410; el pull completo sigue disponible', async () => {
    const fresh = await signIn(server, 'sync-d@ejemplo.mx');
    await push(fresh.token, [upsert(deckRow(now, NODE))]);
    await server.prisma.$executeRaw`
      UPDATE "user" SET "purged_through_seq" = 1000000 WHERE "id" = ${fresh.userId}::uuid`;
    const res = await server
      .api()
      .get('/sync/pull?cursor=5')
      .set('Authorization', `Bearer ${fresh.token}`)
      .expect(410);
    expect(res.body).toMatchObject({ code: 'cursor_expired' });
    expect((await pull(fresh.token, '0')).changes).toHaveLength(1);
  });

  it('SY-T5: un push espera el lock del usuario, así el pull nunca se salta un server_seq', async () => {
    const fresh = await signIn(server, 'sync-e@ejemplo.mx');
    const first = deckRow(now, NODE, { name: 'Primero' });
    const second = deckRow(now, NODE, { name: 'Segundo' });

    // T1 toma el lock, asigna su server_seq y no confirma todavía.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const t1 = server.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fresh.userId}, 0))`;
        await tx.$queryRaw(
          upsertLwwSql('deck', [
            { name: 'id', value: first.id, cast: 'uuid' },
            { name: 'user_id', value: fresh.userId, cast: 'uuid' },
            { name: 'name', value: first.name },
            { name: 'description', value: null },
            ...syncMetaColumns(first),
          ]),
        );
        signalLocked();
        await held;
      },
      { timeout: 20_000 },
    );
    await locked;

    // T2 entra por la API: sin el lock tomaría un server_seq mayor y confirmaría primero.
    let t2Settled = false;
    const t2 = push(fresh.token, [upsert(second)]).finally(() => {
      t2Settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(t2Settled).toBe(false);
    expect((await pull(fresh.token)).changes).toEqual([]);

    release();
    await t1;
    expect((await t2).results[0]?.status).toBe('applied');
    const order = await server.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "deck" WHERE "user_id" = ${fresh.userId}::uuid ORDER BY "server_seq"`;
    expect(order.map((r) => r.id)).toEqual([first.id, second.id]);
  });
});
