import { compareHlc, decodeHlc, MutationSchema } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createDeck, deleteDeck, renameDeck } from './commands';

const T0 = 1_760_000_000_000;

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

describe('comandos de mazo (FRONTEND FE3)', () => {
  it('escribe el mazo y su entrada en el outbox en la misma transacción', async () => {
    const deck = await createDeck({ name: '  Huesos del carpo ' }, { now: T0 });

    expect(await db.decks.get(deck.id)).toEqual(deck);
    expect(deck.name).toBe('Huesos del carpo');
    expect(deck.updatedAt).toBe(decodeHlc(deck.hlc).wall);

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ entity: 'deck', op: 'upsert', status: 'pending', row: deck });
    expect(MutationSchema.safeParse(outbox[0]).success).toBe(true);
  });

  it('si la validación falla no queda nada escrito', async () => {
    await expect(createDeck({ name: '   ' })).rejects.toThrow();
    expect(await db.decks.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('renombrar avanza el HLC aunque el reloj del dispositivo retroceda', async () => {
    const deck = await createDeck({ name: 'Carpo' }, { now: T0 });
    const renamed = await renameDeck(deck.id, 'Huesos del carpo', { now: T0 - 60_000 });
    expect(compareHlc(renamed.hlc, deck.hlc)).toBeGreaterThan(0);
    expect(await db.outbox.count()).toBe(2);
  });

  it('SY5: borrar es una escritura más con deletedAt; no se puede editar algo borrado', async () => {
    const deck = await createDeck({ name: 'Carpo' }, { now: T0 });
    const deleted = await deleteDeck(deck.id, { now: T0 + 1 });
    expect(deleted.deletedAt).toBe(deleted.updatedAt);
    expect(await db.decks.get(deck.id)).toMatchObject({ deletedAt: deleted.updatedAt });
    await expect(renameDeck(deck.id, 'Otro')).rejects.toThrow('deck_not_found');
  });
});
