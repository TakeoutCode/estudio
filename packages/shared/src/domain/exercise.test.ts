import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { isExerciseKind } from './exercise.js';
import { cardFaces, cardOrdinals, NoteContentSchema, NoteSchema } from './note.js';
import { CardKindSchema } from './review.js';

const note = (content: unknown) => ({
  id: newId(),
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
  deckId: newId(),
  topicId: null,
  content,
  origin: 'manual',
});

const tfj = {
  kind: 'true_false_justify',
  statement: 'El nervio axilar inerva el músculo deltoides.',
  isTrue: true,
  justification: 'Sale del fascículo posterior y rodea el cuello quirúrgico del húmero.',
  explanation: '',
} as const;

const open = {
  kind: 'open_question',
  question: '¿Por qué una fractura del cuello quirúrgico del húmero puede debilitar la abducción?',
  key: 'Lesiona el nervio axilar, que inerva al deltoides.',
  explanation: 'El supraespinoso inicia la abducción; el deltoides la continúa.',
} as const;

describe('ejercicios como tipos de nota (LD §2)', () => {
  it('V/F con justificación: afirmación, valor y justificación de referencia; una Card', () => {
    expect(NoteSchema.safeParse(note(tfj)).success).toBe(true);
    expect(NoteContentSchema.safeParse({ ...tfj, justification: ' ' }).success).toBe(false);
    expect(NoteContentSchema.safeParse({ ...tfj, isTrue: 'sí' }).success).toBe(false);
    const parsed = NoteContentSchema.parse(tfj);
    expect(cardOrdinals(parsed)).toEqual([0]);
    expect(cardFaces(parsed, 0)).toEqual({ prompt: tfj.statement, answer: tfj.justification });
  });

  it('pregunta abierta: pregunta y clave; una Card que ella califica', () => {
    expect(NoteSchema.safeParse(note(open)).success).toBe(true);
    expect(NoteContentSchema.safeParse({ ...open, key: '' }).success).toBe(false);
    const parsed = NoteContentSchema.parse(open);
    expect(cardOrdinals(parsed)).toEqual([0]);
    expect(cardFaces(parsed, 0)).toEqual({ prompt: open.question, answer: open.key });
  });

  it('el tipo del repaso (R3) distingue ejercicios de tarjetas', () => {
    expect(isExerciseKind('true_false_justify')).toBe(true);
    expect(isExerciseKind('open_question')).toBe(true);
    expect(isExerciseKind('basic')).toBe(false);
    expect(CardKindSchema.safeParse(tfj.kind).success).toBe(true);
  });
});
