import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import {
  cardFaces,
  cardIdFor,
  cardOrdinals,
  CardSchema,
  EXPLANATION_MAX_LENGTH,
  NoteSchema,
} from './note.js';

const meta = () => ({
  id: newId(),
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
});

const content = {
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: 'Sale del fascículo posterior del plexo braquial.',
  reverse: false,
} as const;

const note = () => ({ ...meta(), deckId: newId(), topicId: null, content, origin: 'manual' });

describe('Note y Card (LEARNING-DESIGN §1)', () => {
  it('acepta una nota básica y la registra para sync', () => {
    expect(NoteSchema.safeParse(note()).success).toBe(true);
    expect(SYNC_ROW_SCHEMAS.note).toBe(NoteSchema);
    expect(SYNC_ROW_SCHEMAS.card).toBe(CardSchema);
  });

  it('LD4: la explicación tiene un máximo y puede ir vacía', () => {
    const long = { ...note(), content: { ...content, explanation: 'x'.repeat(EXPLANATION_MAX_LENGTH + 1) } };
    expect(NoteSchema.safeParse(long).success).toBe(false);
    expect(NoteSchema.safeParse({ ...note(), content: { ...content, explanation: '' } }).success).toBe(true);
  });

  it('exige frente y reverso con texto, y rechaza tipos que aún no existen', () => {
    expect(NoteSchema.safeParse({ ...note(), content: { ...content, front: '   ' } }).success).toBe(false);
    expect(NoteSchema.safeParse({ ...note(), content: { ...content, kind: 'cloze' } }).success).toBe(false);
  });

  it('una básica genera 1 Card, o 2 con la inversa', () => {
    expect(cardOrdinals(content)).toEqual([0]);
    expect(cardOrdinals({ ...content, reverse: true })).toEqual([0, 1]);
  });

  it('SYNC §1: el id de cada Card es determinista por nota y lado', () => {
    const noteId = newId();
    expect(cardIdFor(noteId, 0)).toBe(cardIdFor(noteId, 0));
    expect(cardIdFor(noteId, 0)).not.toBe(cardIdFor(noteId, 1));
    const card = { ...meta(), id: cardIdFor(noteId, 0), noteId, ordinal: 0, createdAt: 1, lapseBaseline: 0 };
    expect(CardSchema.safeParse(card).success).toBe(true);
    expect(CardSchema.safeParse({ ...card, lapseBaseline: -1 }).success).toBe(false);
  });

  it('la inversa pregunta por el reverso', () => {
    expect(cardFaces(content, 0)).toEqual({ prompt: content.front, answer: content.back });
    expect(cardFaces(content, 1)).toEqual({ prompt: content.back, answer: content.front });
  });
});
