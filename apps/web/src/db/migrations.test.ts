import { newId } from '@estudio/shared';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { EstudioDb } from './schema';

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

/** La base tal como la dejó la versión 1 publicada (fixture de SY-T10). */
function openVersion1(name: string): Dexie {
  const v1 = new Dexie(name);
  v1.version(1).stores({
    decks: 'id, updatedAt',
    reviewLogs: 'id, cardId, reviewedAt',
    cardStates: 'cardId, due',
    outbox: 'mutationId, createdAt, status',
    meta: 'key',
  });
  return v1;
}

describe('migraciones de Dexie (SYNC SY9, SY-T10)', () => {
  it('v1 → última: datos, outbox y reloj intactos; aparecen las tablas nuevas', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const deck = { id: newId(), name: 'Carpo', description: null, hlc: 'h', updatedAt: 1, deletedAt: null };
    const pending = {
      mutationId: newId(),
      op: 'upsert',
      entity: 'deck',
      row: deck,
      createdAt: 1,
      attempts: 0,
      status: 'pending',
    };
    const v1 = openVersion1(name);
    await v1.table('decks').add(deck);
    await v1.table('outbox').add(pending);
    await v1.table('meta').put({ key: 'hlc', value: 'reloj' });
    v1.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(7);
    expect(await current.decks.toArray()).toEqual([deck]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.meta.get('hlc')).toEqual({ key: 'hlc', value: 'reloj' });
    expect(await current.userSettings.count()).toBe(0);
    expect(await current.notes.count()).toBe(0);
    expect(await current.cards.count()).toBe(0);
    expect(await current.timerSessions.count()).toBe(0);
    expect(await current.timerBlockLogs.count()).toBe(0);
    current.close();
  });

  it('v2 → última: el cursor vuelve a 0 para bajar lo que la v2 ignoró; el resto intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v2 = openVersion1(name);
    v2.version(2).stores({ userSettings: 'id, section' });
    const log = { id: newId(), cardId: newId(), reviewedAt: 1 };
    const pending = { mutationId: newId(), op: 'append', entity: 'reviewLog', row: log, createdAt: 1 };
    await v2.table('reviewLogs').add(log);
    await v2.table('outbox').add(pending);
    await v2.table('meta').bulkPut([
      { key: 'syncCursor', value: '42' },
      { key: 'deviceId', value: 'dispositivo' },
    ]);
    v2.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(7);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    expect(await current.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dispositivo' });
    expect(await current.reviewLogs.toArray()).toEqual([log]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    current.close();
  });

  it('v3 → v4: el cursor vuelve a 0 para bajar el temporizador; las notas quedan', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v3 = openVersion1(name);
    v3.version(2).stores({ userSettings: 'id, section' });
    v3.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    const note = { id: newId(), deckId: newId(), deletedAt: null };
    await v3.table('notes').add(note);
    await v3.table('meta').put({ key: 'syncCursor', value: '77' });
    v3.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(7);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    expect(await current.notes.toArray()).toEqual([note]);
    current.close();
  });

  it('v4 → última: los bloques del temporizador quedan con extended: false (§5); el outbox intacto', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v4 = openVersion1(name);
    v4.version(2).stores({ userSettings: 'id, section' });
    v4.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v4.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    const block = { id: newId(), timerSessionId: newId(), kind: 'focus', outcome: 'completed', endedAt: 5 };
    const pending = { mutationId: newId(), op: 'append', entity: 'timerBlockLog', row: block, createdAt: 5 };
    await v4.table('timerBlockLogs').add(block);
    await v4.table('outbox').add(pending);
    await v4.table('meta').put({ key: 'syncCursor', value: '9' });
    v4.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(7);
    expect(await current.timerBlockLogs.toArray()).toEqual([{ ...block, extended: false }]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    current.close();
  });

  it('v5 → última: aparecen temas, autoexplicaciones (LD5) y exámenes (R11); el cursor vuelve a 0', async () => {
    const name = `migracion-${newId()}`;
    names.push(name);
    const v5 = openVersion1(name);
    v5.version(2).stores({ userSettings: 'id, section' });
    v5.version(3).stores({ notes: 'id, deckId', cards: 'id, noteId' });
    v5.version(4).stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' });
    v5.version(5).stores({});
    const note = { id: newId(), deckId: newId(), topicId: null, deletedAt: null };
    const pending = { mutationId: newId(), op: 'upsert', entity: 'note', row: note, createdAt: 3 };
    await v5.table('notes').add(note);
    await v5.table('outbox').add(pending);
    await v5.table('meta').put({ key: 'syncCursor', value: '120' });
    v5.close();

    const current = new EstudioDb(name);
    await current.open();
    expect(current.verno).toBe(7);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    expect(await current.notes.toArray()).toEqual([note]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.topics.count()).toBe(0);
    expect(await current.selfExplanations.count()).toBe(0);
    expect(await current.exams.count()).toBe(0);
    current.close();
  });
});
