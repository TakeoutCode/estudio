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
  it('v1 → v2: datos, outbox y reloj intactos; aparece userSettings', async () => {
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
    expect(current.verno).toBe(2);
    expect(await current.decks.toArray()).toEqual([deck]);
    expect(await current.outbox.toArray()).toEqual([pending]);
    expect(await current.meta.get('hlc')).toEqual({ key: 'hlc', value: 'reloj' });
    expect(await current.userSettings.count()).toBe(0);
    current.close();
  });
});
