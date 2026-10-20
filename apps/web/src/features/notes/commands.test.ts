import { cardIdFor, MutationSchema, Rating } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createDeck, deleteDeck } from '@/features/decks';
import { answerCard } from '@/features/study';
import { createNote, deleteNote, updateNote } from './commands';

const T0 = Date.UTC(2026, 9, 20, 15);
const MIN = 60_000;
const SESSION = '0192f1a0-0000-7000-8000-00000000a001';

const content = {
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: 'Sale del fascículo posterior.',
  reverse: false,
} as const;

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

const outboxEntities = async () => (await db.outbox.orderBy('mutationId').toArray()).map((e) => e.entity);

describe('comandos de notas (LEARNING-DESIGN §1, FRONTEND FE3)', () => {
  it('crea nota, Card y estado nuevo en una transacción, con todo en el outbox', async () => {
    const note = await createNote({ deck: { name: 'Hombro' }, content }, { now: T0 });

    const card = await db.cards.get(cardIdFor(note.id, 0));
    expect(card).toMatchObject({
      noteId: note.id,
      ordinal: 0,
      createdAt: T0,
      lapseBaseline: 0,
      deletedAt: null,
    });
    expect(await db.cardStates.get(cardIdFor(note.id, 0))).toMatchObject({ phase: 'new', reps: 0, due: T0 });
    // El mazo nuevo va antes que la nota y la nota antes que su Card (orden de push).
    expect(await outboxEntities()).toEqual(['deck', 'note', 'card']);
    for (const entry of await db.outbox.toArray()) expect(MutationSchema.safeParse(entry).success).toBe(true);
  });

  it('en un mazo que no existe no escribe nada', async () => {
    await expect(createNote({ deck: { id: SESSION }, content })).rejects.toThrow('deck_not_found');
    await expect(
      createNote({ deck: { name: 'Hombro' }, content: { ...content, back: ' ' } }),
    ).rejects.toThrow();
    expect(await db.notes.count()).toBe(0);
    expect(await db.decks.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('la inversa agrega una Card; quitarla la borra y volver a ponerla la revive con su historial', async () => {
    const deck = await createDeck({ name: 'Hombro' }, { now: T0 });
    const note = await createNote(
      { deck: { id: deck.id }, content: { ...content, reverse: true } },
      { now: T0 },
    );
    const reverseId = cardIdFor(note.id, 1);
    expect(await db.cards.where('noteId').equals(note.id).count()).toBe(2);

    await answerCard(
      { cardId: reverseId, rating: Rating.Good, durationMs: 4_000, sessionId: SESSION, confidence: null },
      { now: T0 + MIN },
    );
    await updateNote(note.id, { content: { ...content, reverse: false } }, { now: T0 + 2 * MIN });
    expect(await db.cards.get(reverseId)).toMatchObject({ deletedAt: expect.any(Number) as number });
    expect(await db.cardStates.get(reverseId)).toBeUndefined();

    await updateNote(note.id, { content: { ...content, reverse: true } }, { now: T0 + 3 * MIN });
    expect(await db.cards.get(reverseId)).toMatchObject({ deletedAt: null, createdAt: T0 });
    expect(await db.cardStates.get(reverseId)).toMatchObject({ reps: 1 }); // ARC5: replay de su log
  });

  it('SY5: borrar el mazo borra sus notas y Cards, cada una como su propia escritura', async () => {
    const deck = await createDeck({ name: 'Hombro' }, { now: T0 });
    const a = await createNote(
      { deck: { id: deck.id }, content: { ...content, reverse: true } },
      { now: T0 },
    );
    const b = await createNote({ deck: { id: deck.id }, content }, { now: T0 });
    await db.outbox.clear();

    await deleteDeck(deck.id, { now: T0 + MIN });
    expect((await db.notes.toArray()).every((n) => n.deletedAt !== null)).toBe(true);
    expect((await db.cards.toArray()).every((c) => c.deletedAt !== null)).toBe(true);
    expect(await db.cardStates.count()).toBe(0);
    expect((await outboxEntities()).sort()).toEqual(['card', 'card', 'card', 'deck', 'note', 'note']);
    await expect(updateNote(a.id, { content })).rejects.toThrow('note_not_found');
    await expect(deleteNote(b.id)).rejects.toThrow('note_not_found');
  });

  it('P3: editar una tarjeta para reformular reinicia sus lapsos; editar otra no', async () => {
    const note = await createNote({ deck: { name: 'Hombro' }, content }, { now: T0 });
    const cardId = cardIdFor(note.id, 0);
    const state = await db.cardStates.get(cardId);
    await db.cardStates.put({ ...state!, phase: 'review', lapses: 6 });

    await updateNote(
      note.id,
      { content: { ...content, explanation: 'Otra forma de verlo.' } },
      { now: T0 + MIN },
    );
    expect(await db.cards.get(cardId)).toMatchObject({ lapseBaseline: 6 });

    await db.outbox.clear();
    await updateNote(
      note.id,
      { content: { ...content, explanation: 'Un ajuste menor.' } },
      { now: T0 + 2 * MIN },
    );
    expect(await db.cards.get(cardId)).toMatchObject({ lapseBaseline: 6 });
    expect(await outboxEntities()).toEqual(['note']); // la Card no se reescribe
  });
});

describe('temas de las notas (LD5, P4)', () => {
  const topic = { name: 'Plexo braquial', explanation: 'Raíces C5-T1.' };

  it('LD5: un tema nuevo se crea con la nota, en la misma transacción y antes en el outbox', async () => {
    const note = await createNote({ deck: { name: 'Hombro' }, content, topic }, { now: T0 });
    const saved = await db.topics.get(note.topicId ?? '');
    expect(saved).toMatchObject({
      deckId: note.deckId,
      name: 'Plexo braquial',
      explanation: 'Raíces C5-T1.',
    });
    expect(await outboxEntities()).toEqual(['deck', 'topic', 'note', 'card']);
  });

  it('LD5: elegir un tema de otro mazo falla y no escribe nada', async () => {
    const first = await createNote({ deck: { name: 'Hombro' }, content, topic }, { now: T0 });
    const other = await createDeck({ name: 'Codo' }, { now: T0 + 1 });
    const before = await db.outbox.count();
    await expect(
      createNote({ deck: { id: other.id }, content, topic: { id: first.topicId ?? '' } }),
    ).rejects.toThrow('topic_not_found');
    expect(await db.outbox.count()).toBe(before);
  });

  it('al editar: sin `topic` lo conserva; con null lo quita; con otro del mazo lo cambia', async () => {
    const note = await createNote({ deck: { name: 'Hombro' }, content, topic }, { now: T0 });
    const kept = await updateNote(note.id, { content }, { now: T0 + MIN });
    expect(kept.topicId).toBe(note.topicId);
    const cleared = await updateNote(note.id, { content, topic: null }, { now: T0 + 2 * MIN });
    expect(cleared.topicId).toBeNull();
    const moved = await updateNote(
      note.id,
      { content, topic: { name: 'Manguito rotador', explanation: '' } },
      { now: T0 + 3 * MIN },
    );
    expect((await db.topics.get(moved.topicId ?? ''))?.name).toBe('Manguito rotador');
  });
});
