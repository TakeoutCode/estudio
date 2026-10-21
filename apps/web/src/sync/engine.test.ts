import {
  cardIdFor,
  compareHlc,
  encodeHlc,
  newId,
  type PushRequest,
  Rating,
  type ReviewLog,
  type TimerBlockLog,
} from '@estudio/shared';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { hlcWall, nextHlc } from '@/db/clock';
import { EstudioDb } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { createDeck, deleteDeck, renameDeck } from '@/features/decks';
import { createNote, deleteNote, noteTables } from '@/features/notes';
import { answerCard } from '@/features/study';
import { ApiError } from '@/lib/api';
import { FakeSyncServer } from '@/test/fake-sync-server';
import { pullAll, pushOutbox, syncOnce, type SyncTransport } from './engine';

const T0 = Date.UTC(2026, 9, 20, 12);
const OTHER_NODE = '0192f1a0-0000-7000-8000-0000000000ff';

const open: EstudioDb[] = [];
const replica = () => {
  const database = new EstudioDb(`sync-${newId()}`);
  open.push(database);
  return database;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((database) => database.delete()));
});

const remoteDeck = (wall: number, overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  name: 'Remoto',
  description: null,
  hlc: encodeHlc({ wall, counter: 0, node: OTHER_NODE }),
  updatedAt: wall,
  deletedAt: null,
  ...overrides,
});

const reviewLog = (database: EstudioDb): Promise<ReviewLog> =>
  database.transaction('rw', [database.reviewLogs, database.outbox, database.meta], async () => {
    const log: ReviewLog = {
      id: newId(),
      cardId: newId(),
      cardKind: 'basic',
      reviewedAt: T0,
      rating: 3,
      durationMs: 3000,
      type: 'review',
      confidence: null,
      sessionId: newId(),
      deviceId: OTHER_NODE,
    };
    await writeAndQueue(database, 'reviewLog', log, T0);
    return log;
  });

describe('push (SYNC SY8)', () => {
  it('aplicado, duplicado o stale sale del outbox; lo rechazado se queda marcado y no se reenvía', async () => {
    const database = replica();
    const ok = await createDeck({ name: 'Carpo' }, { database, now: T0 });
    const bad = await createDeck({ name: 'Tarso' }, { database, now: T0 + 1 });
    const sent: PushRequest[] = [];
    const transport: SyncTransport = {
      push: (request) => {
        sent.push(request);
        return Promise.resolve({
          results: request.mutations.map((m) => ({
            mutationId: m.mutationId,
            status: m.row.id === bad.id ? ('rejected' as const) : ('applied' as const),
            ...(m.row.id === bad.id ? { code: 'validation_failed' as const } : {}),
          })),
        });
      },
      pull: () => Promise.reject(new Error('no se usa')),
    };

    expect(await pushOutbox(database, transport)).toEqual({ pushed: 1, rejected: 1 });
    const left = await database.outbox.toArray();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      status: 'rejected',
      attempts: 1,
      code: 'validation_failed', // SY8: Ajustes › Sincronización dice por qué
      row: { id: bad.id },
    });
    expect(sent[0]?.mutations.map((m) => m.row.id)).toEqual([ok.id, bad.id]); // orden de creación

    await pushOutbox(database, transport);
    expect(sent).toHaveLength(1);
  });

  it('SY-T3: si la respuesta se pierde, el reintento recibe duplicate y no duplica nada', async () => {
    const database = replica();
    const server = new FakeSyncServer();
    await createDeck({ name: 'Carpo' }, { database, now: T0 });
    server.dropNextPushResponse = true;
    await expect(syncOnce(database, server.transport)).rejects.toThrow(ApiError);
    expect(await database.outbox.count()).toBe(1);

    await syncOnce(database, server.transport);
    expect(await database.outbox.count()).toBe(0);
    expect(server.count('deck')).toBe(1);
  });

  const blockLog = (): TimerBlockLog => ({
    id: newId(),
    timerSessionId: newId(),
    deviceId: OTHER_NODE,
    kind: 'focus',
    blockIndex: 0,
    mode: 'flexible',
    startedAt: T0,
    endedAt: T0 + 25 * 60_000,
    plannedMs: 25 * 60_000,
    activeMs: 25 * 60_000,
    outcome: 'completed',
    extended: false,
  });

  it('SY1: un TimerBlockLog se encola como append, no como upsert, y el lote se acepta', async () => {
    const database = replica();
    const server = new FakeSyncServer();
    await createDeck({ name: 'Carpo' }, { database, now: T0 });
    await database.transaction('rw', [database.timerBlockLogs, database.outbox, database.meta], () =>
      writeAndQueue(database, 'timerBlockLog', blockLog(), T0 + 1),
    );
    expect((await database.outbox.toArray()).map((e) => e.op)).toEqual(['upsert', 'append']);

    await syncOnce(database, server.transport);
    expect(await database.outbox.count()).toBe(0);
    expect(server.count('deck')).toBe(1);
    expect(server.count('timerBlockLog')).toBe(1);
  });

  it('SY1: una entrada guardada con otro op (versión anterior) se envía con el de su estrategia', async () => {
    const database = replica();
    const server = new FakeSyncServer();
    const block = blockLog();
    await database.timerBlockLogs.add(block);
    await database.outbox.add({
      mutationId: newId(),
      op: 'upsert',
      entity: 'timerBlockLog',
      row: block,
      createdAt: T0,
      attempts: 0,
      status: 'pending',
    });

    await syncOnce(database, server.transport);
    expect(await database.outbox.count()).toBe(0);
    expect(server.alive('timerBlockLog')).toEqual([block]);
  });
});

describe('pull (SYNC SY4)', () => {
  it('LWW: una edición local sin enviar con HLC mayor no se pisa', async () => {
    const database = replica();
    const server = new FakeSyncServer();
    const deck = await createDeck({ name: 'Local nuevo' }, { database, now: T0 + 10_000 });
    await server.push({
      deviceId: OTHER_NODE,
      mutations: [
        { mutationId: newId(), op: 'upsert', entity: 'deck', row: remoteDeck(T0, { id: deck.id }) },
      ],
    });

    await pullAll(database, server.transport, () => T0);
    expect((await database.decks.get(deck.id))?.name).toBe('Local nuevo');
  });

  it('LWW: un cambio remoto más nuevo reemplaza, y un borrado remoto elimina la fila local', async () => {
    const database = replica();
    const server = new FakeSyncServer();
    const deck = await createDeck({ name: 'Local' }, { database, now: T0 });
    await syncOnce(database, server.transport, () => T0);

    const renamed = remoteDeck(T0 + 1000, { id: deck.id, name: 'Renombrado en la PC' });
    await server.push({
      deviceId: OTHER_NODE,
      mutations: [{ mutationId: newId(), op: 'upsert', entity: 'deck', row: renamed }],
    });
    await pullAll(database, server.transport, () => T0);
    expect((await database.decks.get(deck.id))?.name).toBe('Renombrado en la PC');

    const removed = {
      ...renamed,
      hlc: encodeHlc({ wall: T0 + 2000, counter: 0, node: OTHER_NODE }),
      updatedAt: T0 + 2000,
      deletedAt: T0 + 2000,
    };
    await server.push({
      deviceId: OTHER_NODE,
      mutations: [{ mutationId: newId(), op: 'upsert', entity: 'deck', row: removed }],
    });
    await pullAll(database, server.transport, () => T0);
    expect(await database.decks.get(deck.id)).toBeUndefined();
  });

  it('append: un ReviewLog llega una sola vez aunque se repita el pull', async () => {
    const source = replica();
    const target = replica();
    const server = new FakeSyncServer();
    const log = await reviewLog(source);
    await syncOnce(source, server.transport, () => T0);

    await pullAll(target, server.transport, () => T0);
    await target.meta.delete('syncCursor'); // fuerza a recibirlo otra vez
    await pullAll(target, server.transport, () => T0);
    expect(await target.reviewLogs.toArray()).toEqual([log]);
  });

  it('pagina hasta el final, guarda el cursor y adelanta el reloj local más allá de lo remoto', async () => {
    const database = replica();
    const server = new FakeSyncServer(2);
    const far = T0 + 3_600_000;
    await server.push({
      deviceId: OTHER_NODE,
      mutations: Array.from({ length: 5 }, (_, i) => ({
        mutationId: newId(),
        op: 'upsert' as const,
        entity: 'deck' as const,
        row: remoteDeck(far + i),
      })),
    });

    expect(await pullAll(database, server.transport, () => T0)).toBe(5);
    expect(server.pullsServed).toBe(3);
    expect(await database.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '5' });
    // SY2: lo próximo que escriba este dispositivo ordena después de lo que ya vio.
    const local = await database.transaction('rw', database.meta, () => nextHlc(database, T0));
    expect(compareHlc(local, encodeHlc({ wall: far + 4, counter: 0, node: OTHER_NODE }))).toBeGreaterThan(0);
  });

  it('SY-T9: tras un 410 hace el pull completo, borra lo que ya no existe y conserva el outbox', async () => {
    const database = replica();
    const server = new FakeSyncServer();
    const ghost = await createDeck({ name: 'Borrado en otro lado' }, { database, now: T0 });
    await syncOnce(database, server.transport, () => T0);

    // Otro dispositivo lo borra, el servidor purga el borrado y ella nunca lo vio.
    const tombstone = remoteDeck(T0 + 1000, { id: ghost.id, deletedAt: T0 + 1000 });
    await server.push({
      deviceId: OTHER_NODE,
      mutations: [{ mutationId: newId(), op: 'upsert', entity: 'deck', row: tombstone }],
    });
    await server.push({
      deviceId: OTHER_NODE,
      mutations: [{ mutationId: newId(), op: 'upsert', entity: 'deck', row: remoteDeck(T0 + 2000) }],
    });
    server.purgeTombstones();
    const offline = await createDeck({ name: 'Creado sin red' }, { database, now: T0 + 3000 });
    await database.meta.put({ key: 'syncCursor', value: '1' });

    await pullAll(database, server.transport, () => T0);
    expect(await database.decks.get(ghost.id)).toBeUndefined();
    expect(await database.decks.get(offline.id)).toMatchObject({ name: 'Creado sin red' });
    expect(await database.outbox.count()).toBe(1);
  });
});

describe('proyección de tarjetas tras el pull (ARC5)', () => {
  it('otro dispositivo llega al mismo estado FSRS aunque los repasos bajen antes que la tarjeta', async () => {
    const source = replica();
    const target = replica();
    const server = new FakeSyncServer(1); // una fila por página
    const content = { kind: 'basic', front: '¿C2?', back: 'Axis', explanation: '', reverse: false } as const;
    const note = await createNote({ deck: { name: 'Columna' }, content }, { database: source, now: T0 });
    const cardId = cardIdFor(note.id, 0);
    const answer = (rating: Rating, at: number) =>
      answerCard(
        { cardId, rating, durationMs: 4_000, sessionId: newId(), confidence: null },
        { database: source, now: at },
      );
    await answer(Rating.Good, T0 + 60_000);
    await answer(Rating.Good, T0 + 11 * 60_000);
    await answer(Rating.Again, T0 + 4 * 86_400_000);
    // Reescribir la tarjeta le da un server_seq posterior a sus repasos.
    await source.transaction('rw', noteTables(source), async () => {
      const card = await source.cards.get(cardId);
      const hlc = await nextHlc(source, T0 + 5 * 86_400_000);
      await writeAndQueue(source, 'card', { ...card!, hlc, updatedAt: hlcWall(hlc) }, T0);
    });
    await syncOnce(source, server.transport, () => T0);

    await pullAll(target, server.transport, () => T0);
    expect(await target.cardStates.get(cardId)).toEqual(await source.cardStates.get(cardId));
    expect((await target.cardStates.get(cardId))?.lapses).toBe(1);
  });

  it('una tarjeta borrada en otro dispositivo sale de la proyección', async () => {
    const source = replica();
    const target = replica();
    const server = new FakeSyncServer();
    const content = {
      kind: 'basic',
      front: '¿C7?',
      back: 'Prominente',
      explanation: '',
      reverse: false,
    } as const;
    const note = await createNote({ deck: { name: 'Columna' }, content }, { database: source, now: T0 });
    await syncOnce(source, server.transport, () => T0);
    await pullAll(target, server.transport, () => T0);
    expect(await target.cardStates.count()).toBe(1);

    await deleteNote(note.id, { database: source, now: T0 + 1 });
    await syncOnce(source, server.transport, () => T0);
    await pullAll(target, server.transport, () => T0);
    expect(await target.cardStates.count()).toBe(0);
  });
});

describe('SY-T12: convergencia de 3 réplicas', () => {
  type Op =
    | { kind: 'create'; r: number; name: string }
    | { kind: 'rename'; r: number; pick: number; name: string }
    | { kind: 'delete'; r: number; pick: number }
    | { kind: 'sync'; r: number; drop: boolean }
    | { kind: 'tick'; ms: number };

  const name = fc.constantFrom('Carpo', 'Tarso', 'Nervios craneales', 'Manguito rotador', 'Columna');
  const r = fc.integer({ min: 0, max: 2 });
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('create' as const), r, name }),
    fc.record({ kind: fc.constant('rename' as const), r, pick: fc.nat(), name }),
    fc.record({ kind: fc.constant('delete' as const), r, pick: fc.nat() }),
    fc.record({ kind: fc.constant('sync' as const), r, drop: fc.boolean() }),
    fc.record({ kind: fc.constant('tick' as const), ms: fc.integer({ min: 0, max: 5000 }) }),
  );

  it('con entregas perdidas, reintentos y relojes desfasados, todas terminan iguales al servidor', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 30 }), async (ops) => {
        const server = new FakeSyncServer(3);
        const replicas = [replica(), replica(), replica()];
        const skew = [-120_000, 0, 90_000]; // SY-T7: relojes de dispositivo desfasados
        let time = T0;
        const now = (i: number) => time + (skew[i] ?? 0);
        const alive = async (i: number) =>
          (await replicas[i]!.decks.toArray()).filter((d) => d.deletedAt === null);

        for (const step of ops) {
          if (step.kind === 'tick') {
            time += step.ms;
            continue;
          }
          const database = replicas[step.r]!;
          const opts = { database, now: now(step.r) };
          if (step.kind === 'create') await createDeck({ name: step.name }, opts);
          if (step.kind === 'rename' || step.kind === 'delete') {
            const decks = await alive(step.r);
            const target = decks[step.pick % Math.max(decks.length, 1)];
            if (!target) continue;
            if (step.kind === 'rename') await renameDeck(target.id, step.name, opts);
            else await deleteDeck(target.id, opts);
          }
          if (step.kind === 'sync') {
            server.dropNextPushResponse = step.drop;
            await syncOnce(database, server.transport, () => now(step.r)).catch(() => undefined);
            server.dropNextPushResponse = false;
          }
        }

        for (let round = 0; round < 2; round += 1) {
          for (const [i, database] of replicas.entries())
            await syncOnce(database, server.transport, () => now(i));
        }

        const expected = server.alive('deck');
        for (const [i, database] of replicas.entries()) {
          const local = (await alive(i)).sort((a, b) => a.id.localeCompare(b.id));
          expect(local).toEqual(expected);
          expect(await database.outbox.count()).toBe(0);
        }
      }),
      { numRuns: 40 },
    );
  });
});
