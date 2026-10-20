import { compareHlc, decodeHlc, MutationSchema } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import {
  createDeck,
  deleteDeck,
  deleteTopic,
  renameDeck,
  setDeckPaused,
  updateDeck,
  updateTopic,
} from './commands';

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

  it('editar nombre y descripción; una descripción en blanco queda en null', async () => {
    const deck = await createDeck({ name: 'Carpo' }, { now: T0 });
    const edited = await updateDeck(
      deck.id,
      { name: 'Huesos del carpo', description: 'Parcial 2' },
      { now: T0 + 1 },
    );
    expect(edited).toMatchObject({ name: 'Huesos del carpo', description: 'Parcial 2' });
    const cleared = await updateDeck(deck.id, { name: 'Carpo', description: '   ' }, { now: T0 + 2 });
    expect(cleared.description).toBeNull();
    expect((await db.outbox.toArray()).map((m) => m.row)).toContainEqual(cleared);
    await expect(updateDeck(deck.id, { name: ' ', description: '' })).rejects.toThrow();
  });

  it('pausar escribe pausedAt con la hora del HLC; reanudar lo vuelve null; ambos viajan', async () => {
    const deck = await createDeck({ name: 'Carpo' }, { now: T0 });
    expect(deck.pausedAt).toBeNull();
    const paused = await setDeckPaused(deck.id, true, { now: T0 + 1 });
    expect(paused.pausedAt).toBe(paused.updatedAt);
    const resumed = await setDeckPaused(deck.id, false, { now: T0 + 2 });
    expect(resumed.pausedAt).toBeNull();
    expect((await db.outbox.toArray()).map((m) => m.row)).toEqual([deck, paused, resumed]);
  });

  it('SY5: borrar es una escritura más con deletedAt; no se puede editar algo borrado', async () => {
    const deck = await createDeck({ name: 'Carpo' }, { now: T0 });
    const deleted = await deleteDeck(deck.id, { now: T0 + 1 });
    expect(deleted.deletedAt).toBe(deleted.updatedAt);
    expect(await db.decks.get(deck.id)).toMatchObject({ deletedAt: deleted.updatedAt });
    await expect(renameDeck(deck.id, 'Otro')).rejects.toThrow('deck_not_found');
  });
});

describe('temas (LD5, SY5)', () => {
  const content = {
    kind: 'basic',
    front: '¿C5?',
    back: 'Raíz superior',
    explanation: '',
    reverse: false,
  } as const;

  it('editar el tema cambia nombre y explicación con un HLC nuevo', async () => {
    const note = await createNote({
      deck: { name: 'Hombro' },
      content,
      topic: { name: 'Plexo', explanation: '' },
    });
    const topicId = note.topicId ?? '';
    const updated = await updateTopic(topicId, { name: 'Plexo braquial', explanation: 'C5-T1' }, { now: T0 });
    expect(await db.topics.get(topicId)).toEqual(updated);
    expect(updated).toMatchObject({ name: 'Plexo braquial', explanation: 'C5-T1' });
  });

  it('SY5: borrar un tema deja sus notas sin tema, cada una como su propia escritura', async () => {
    const note = await createNote({
      deck: { name: 'Hombro' },
      content,
      topic: { name: 'Plexo', explanation: '' },
    });
    const topicId = note.topicId ?? '';
    await db.outbox.clear();
    const deleted = await deleteTopic(topicId, { now: T0 + 5 });
    expect(deleted.deletedAt).toBe(deleted.updatedAt);
    expect((await db.notes.get(note.id))?.topicId).toBeNull();
    expect((await db.outbox.toArray()).map((e) => e.entity)).toEqual(['topic', 'note']);
    await expect(updateTopic(topicId, { name: 'Otro', explanation: '' })).rejects.toThrow('topic_not_found');
  });

  it('SY5: borrar un mazo borra también sus temas', async () => {
    const note = await createNote({
      deck: { name: 'Hombro' },
      content,
      topic: { name: 'Plexo', explanation: '' },
    });
    await deleteDeck(note.deckId, { now: T0 + 10 });
    expect((await db.topics.get(note.topicId ?? ''))?.deletedAt).not.toBeNull();
    expect((await db.notes.get(note.id))?.deletedAt).not.toBeNull();
  });
});
