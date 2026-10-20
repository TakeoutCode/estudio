import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import {
  cardFaces,
  cardIdFor,
  cardOrdinals,
  CardSchema,
  clozeNumbers,
  clozeSegments,
  EXPLANATION_MAX_LENGTH,
  type NoteContent,
  NoteContentSchema,
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

  it('exige frente y reverso con texto, y rechaza tipos que aún no existen (oclusión de imagen)', () => {
    expect(NoteSchema.safeParse({ ...note(), content: { ...content, front: '   ' } }).success).toBe(false);
    expect(
      NoteSchema.safeParse({ ...note(), content: { ...content, kind: 'image_occlusion' } }).success,
    ).toBe(false);
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

describe('tipos de LD §1', () => {
  const cloze = {
    kind: 'cloze',
    text: 'El {{c1::nervio axilar}} inerva el {{c2::deltoides::músculo}} y el {{c1::redondo menor}}.',
    explanation: '',
  } as const;

  it('cloze: una Card por número de hueco; sin huecos no es válida', () => {
    expect(cardOrdinals(cloze)).toEqual([1, 2]);
    expect(clozeNumbers('Sin huecos')).toEqual([]);
    expect(NoteContentSchema.safeParse({ ...cloze, text: 'Sin huecos' }).success).toBe(false);
  });

  it('cloze: el hueco de la Card se oculta (con su pista) y los otros se ven completos', () => {
    expect(cardFaces(cloze, 2)).toEqual({
      prompt: 'El nervio axilar inerva el [músculo] y el redondo menor.',
      answer: 'El nervio axilar inerva el deltoides y el redondo menor.',
    });
    expect(cardFaces(cloze, 1).prompt).toBe('El […] inerva el deltoides y el […].');
    expect(clozeSegments(cloze.text, 2)).toEqual([
      { kind: 'text', text: 'El ' },
      { kind: 'text', text: 'nervio axilar' },
      { kind: 'text', text: ' inerva el ' },
      { kind: 'blank', answer: 'deltoides', hint: 'músculo' },
      { kind: 'text', text: ' y el ' },
      { kind: 'text', text: 'redondo menor' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('type_answer: 1 Card; la respuesta es corta', () => {
    const typed: NoteContent = {
      kind: 'type_answer',
      front: '¿Hueso del pulgar?',
      back: 'Trapecio',
      explanation: '',
    };
    expect(cardOrdinals(typed)).toEqual([0]);
    expect(cardFaces(typed, 0)).toEqual({ prompt: '¿Hueso del pulgar?', answer: 'Trapecio' });
    expect(NoteContentSchema.safeParse({ ...typed, back: 'x'.repeat(201) }).success).toBe(false);
  });

  it('multiple_choice: 3 a 5 opciones distintas y una correcta dentro del rango', () => {
    const mc: NoteContent = {
      kind: 'multiple_choice',
      question: '¿Qué nervio inerva el deltoides?',
      options: ['Radial', 'Axilar', 'Mediano'],
      correct: 1,
      explanation: '',
    };
    expect(NoteContentSchema.safeParse(mc).success).toBe(true);
    expect(cardOrdinals(mc)).toEqual([0]);
    expect(cardFaces(mc, 0)).toEqual({
      prompt: '¿Qué nervio inerva el deltoides?\na) Radial\nb) Axilar\nc) Mediano',
      answer: 'b) Axilar',
    });
    expect(NoteContentSchema.safeParse({ ...mc, options: ['Radial', 'Axilar'] }).success).toBe(false);
    expect(NoteContentSchema.safeParse({ ...mc, options: ['Radial', 'radial', 'Axilar'] }).success).toBe(
      false,
    );
    expect(NoteContentSchema.safeParse({ ...mc, correct: 3 }).success).toBe(false);
  });
});

describe('bordes de las caras', () => {
  it('cloze al principio y al final del texto, y con pista vacía', () => {
    expect(clozeSegments('{{c1::Axilar}} y {{c2::radial::}}', 2)).toEqual([
      { kind: 'text', text: 'Axilar' },
      { kind: 'text', text: ' y ' },
      { kind: 'blank', answer: 'radial', hint: null },
    ]);
  });

  it('basic: la inversa muestra la respuesta como pregunta', () => {
    expect(cardFaces({ ...content, reverse: true }, 1)).toEqual({
      prompt: content.back,
      answer: content.front,
    });
  });
});
