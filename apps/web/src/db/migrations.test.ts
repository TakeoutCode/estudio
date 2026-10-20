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
  it('v1 → última: datos, outbox y reloj intactos; aparecen userSettings, notes y cards', async () => {
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
    expect(current.verno).toBe(3);
    expect(await current.decks.toArray()).toEqual([deck]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.meta.get('hlc')).toEqual({ key: 'hlc', value: 'reloj' });
    expect(await current.userSettings.count()).toBe(0);
    expect(await current.notes.count()).toBe(0);
    expect(await current.cards.count()).toBe(0);
    current.close();
  });

  it('v2 → v3: el cursor vuelve a 0 para bajar notas y tarjetas que la v2 ignoró; el resto intacto', async () => {
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
    expect(current.verno).toBe(3);
    expect(await current.meta.get('syncCursor')).toEqual({ key: 'syncCursor', value: '0' });
    expect(await current.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'dispositivo' });
    expect(await current.reviewLogs.toArray()).toEqual([log]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    current.close();
  });
});
