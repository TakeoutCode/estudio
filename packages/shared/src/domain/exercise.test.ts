import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import {
  CLINICAL_QUESTIONS,
  clinicalQuestion,
  isExerciseKind,
  LABEL_IMAGE_LABELS,
  MATCHING_PAIRS,
  SEQUENCE_ITEMS,
} from './exercise.js';
import { cardFaces, cardOrdinals, NoteContentSchema, noteImageAssetId, NoteSchema } from './note.js';
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

describe('secuencia (LD §2)', () => {
  const sequence = {
    kind: 'sequence',
    prompt: 'Ordena las capas de la piel, de superficial a profunda.',
    items: ['Epidermis', 'Dermis', 'Hipodermis'],
    explanation: '',
  } as const;

  it('de 3 a 10 elementos distintos en su orden correcto; una Card', () => {
    expect(NoteSchema.safeParse(note(sequence)).success).toBe(true);
    expect(NoteContentSchema.safeParse({ ...sequence, items: ['Epidermis', 'Dermis'] }).success).toBe(false);
    expect(
      NoteContentSchema.safeParse({ ...sequence, items: ['Dermis', 'dermis', 'Hipodermis'] }).success,
    ).toBe(false);
    const many = Array.from({ length: SEQUENCE_ITEMS.max + 1 }, (_, i) => `Paso ${String(i)}`);
    expect(NoteContentSchema.safeParse({ ...sequence, items: many }).success).toBe(false);
    const parsed = NoteContentSchema.parse(sequence);
    expect(cardOrdinals(parsed)).toEqual([0]);
    expect(cardFaces(parsed, 0).answer).toBe('1. Epidermis\n2. Dermis\n3. Hipodermis');
    expect(isExerciseKind('sequence')).toBe(true);
  });
});

describe('relacionar columnas (LD §2)', () => {
  const matching = {
    kind: 'matching',
    prompt: 'Relaciona cada músculo con su inervación.',
    pairs: [
      { left: 'Deltoides', right: 'Axilar' },
      { left: 'Bíceps braquial', right: 'Musculocutáneo' },
      { left: 'Tríceps braquial', right: 'Radial' },
    ],
    explanation: '',
  } as const;

  it('de 3 a 8 pares, sin repetir en ninguna columna; una Card', () => {
    expect(NoteSchema.safeParse(note(matching)).success).toBe(true);
    expect(NoteContentSchema.safeParse({ ...matching, pairs: matching.pairs.slice(0, 2) }).success).toBe(
      false,
    );
    const repeatedRight = matching.pairs.map((p) => ({ ...p, right: 'Radial' }));
    expect(NoteContentSchema.safeParse({ ...matching, pairs: repeatedRight }).success).toBe(false);
    const many = Array.from({ length: MATCHING_PAIRS.max + 1 }, (_, i) => ({
      left: `A${String(i)}`,
      right: `B${String(i)}`,
    }));
    expect(NoteContentSchema.safeParse({ ...matching, pairs: many }).success).toBe(false);
    const parsed = NoteContentSchema.parse(matching);
    expect(cardOrdinals(parsed)).toEqual([0]);
    expect(cardFaces(parsed, 0).answer).toBe(
      'Deltoides → Axilar\nBíceps braquial → Musculocutáneo\nTríceps braquial → Radial',
    );
  });
});

describe('etiquetar una imagen (label_image, R10, LD §2)', () => {
  const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
  const carpus = {
    kind: 'label_image',
    imageAssetId: newId(),
    prompt: 'Nombra los huesos marcados.',
    alt: 'Mano derecha, vista palmar, con los huesos del carpo marcados.',
    labels: [
      { n: 2, label: 'Semilunar', rects: [rect] },
      { n: 1, label: 'Escafoides', rects: [rect] },
    ],
    explanation: '',
  } as const;

  it('imagen con al menos 2 etiquetas numeradas; una sola Card y su imagen va antes (FE8)', () => {
    expect(NoteSchema.safeParse(note(carpus)).success).toBe(true);
    expect(NoteContentSchema.safeParse({ ...carpus, labels: carpus.labels.slice(0, 1) }).success).toBe(false);
    expect(
      NoteContentSchema.safeParse({ ...carpus, labels: carpus.labels.map((l) => ({ ...l, n: 1 })) }).success,
    ).toBe(false);
    const many = Array.from({ length: LABEL_IMAGE_LABELS.max + 1 }, (_, i) => ({
      n: i + 1,
      label: `H${String(i)}`,
      rects: [rect],
    }));
    expect(NoteContentSchema.safeParse({ ...carpus, labels: many }).success).toBe(false);
    const parsed = NoteContentSchema.parse(carpus);
    expect(cardOrdinals(parsed)).toEqual([0]);
    expect(cardFaces(parsed, 0).answer).toBe('1. Escafoides\n2. Semilunar'); // por su número
    expect(noteImageAssetId(parsed)).toBe(carpus.imageAssetId);
    expect(
      noteImageAssetId(
        NoteContentSchema.parse({ kind: 'open_question', question: 'q', key: 'k', explanation: '' }),
      ),
    ).toBeNull();
  });
});

describe('caso clínico (clinical_case, LD §2)', () => {
  const clinical = {
    kind: 'clinical_case',
    vignette: 'Mujer de 34 años que cayó sobre la mano extendida; duele la tabaquera anatómica.',
    questions: [
      {
        n: 1,
        type: 'multiple_choice',
        question: '¿Qué hueso sospechas?',
        options: ['Escafoides', 'Semilunar', 'Pisiforme'],
        correct: 0,
      },
      {
        n: 2,
        type: 'type_answer',
        question: '¿Qué arteria lo irriga en forma retrógrada?',
        answer: 'Radial',
      },
      {
        n: 4,
        type: 'open',
        question: '¿Por qué puede necrosarse?',
        key: 'Irrigación retrógrada: el polo proximal se queda sin sangre.',
      },
    ],
    explanation: '',
  } as const;

  it('una Card por subpregunta, con su número estable como ordinal', () => {
    expect(NoteSchema.safeParse(note(clinical)).success).toBe(true);
    const parsed = NoteContentSchema.parse(clinical);
    expect(cardOrdinals(parsed)).toEqual([1, 2, 4]);
    expect(cardFaces(parsed, 2)).toEqual({
      prompt: `${clinical.vignette}\n\n¿Qué arteria lo irriga en forma retrógrada?`,
      answer: 'Radial',
    });
    expect(cardFaces(parsed, 1).answer).toBe('a) Escafoides');
    expect(cardFaces(parsed, 0)).toEqual({ prompt: clinical.vignette, answer: '' });
    expect(parsed.kind === 'clinical_case' ? clinicalQuestion(parsed, 4) : null).toMatchObject({
      position: 3,
      total: 3,
    });
  });

  it('rechaza subpreguntas inválidas, números repetidos y más de las que caben', () => {
    const [mc, typed, open] = clinical.questions;
    expect(NoteContentSchema.safeParse({ ...clinical, questions: [] }).success).toBe(false);
    expect(NoteContentSchema.safeParse({ ...clinical, questions: [mc, { ...typed, n: 1 }] }).success).toBe(
      false,
    );
    expect(NoteContentSchema.safeParse({ ...clinical, questions: [{ ...mc, correct: 3 }] }).success).toBe(
      false,
    );
    expect(NoteContentSchema.safeParse({ ...clinical, questions: [{ ...open, key: ' ' }] }).success).toBe(
      false,
    );
    const many = Array.from({ length: CLINICAL_QUESTIONS.max + 1 }, (_, i) => ({ ...typed, n: i + 1 }));
    expect(NoteContentSchema.safeParse({ ...clinical, questions: many }).success).toBe(false);
    expect(isExerciseKind('clinical_case')).toBe(true);
  });
});
