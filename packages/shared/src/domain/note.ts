import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

// Notas y tarjetas (LEARNING-DESIGN §1). Una `Note` es el contenido que ella crea (en la UI,
// "tarjeta"); una `Card` es lo que programa FSRS, una por lado o hueco. Ambas son LWW.

/** LD4: la explicación breve que se muestra tras cada intento (R4). */
export const EXPLANATION_MAX_LENGTH = 400;

const text = (max: number) => z.string().trim().min(1).max(max);

/** `basic`: pregunta y respuesta; con `reverse`, también la tarjeta inversa (LD §1). */
export const BasicContentSchema = z
  .object({
    kind: z.literal('basic'),
    front: text(2000),
    back: text(2000),
    explanation: z.string().trim().max(EXPLANATION_MAX_LENGTH),
    reverse: z.boolean(),
  })
  .strict();

const explanation = () => z.string().trim().max(EXPLANATION_MAX_LENGTH);

/** `{{c1::respuesta}}` o `{{c1::respuesta::pista}}` (LD §1: una Card por cada número). */
const CLOZE = /\{\{c(\d{1,2})::(.+?)(?:::(.*?))?\}\}/g;

/** Números de hueco distintos, en orden (1, 2, …): las Cards de una nota `cloze`. */
export function clozeNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(CLOZE)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/** `cloze`: un texto con huecos; cada número de hueco es una Card que ella califica (LD §1). */
export const ClozeContentSchema = z
  .object({
    kind: z.literal('cloze'),
    text: text(4000).refine((t) => clozeNumbers(t).length > 0, 'no_cloze'),
    explanation: explanation(),
  })
  .strict();

/** `type_answer`: escribir la respuesta; la calificación es automática (LD2). */
export const TypeAnswerContentSchema = z
  .object({
    kind: z.literal('type_answer'),
    front: text(2000),
    back: text(200),
    explanation: explanation(),
  })
  .strict();

/** `multiple_choice`: 3 a 5 opciones distintas y una correcta (LD §1). */
export const MultipleChoiceContentSchema = z
  .object({
    kind: z.literal('multiple_choice'),
    question: text(2000),
    options: z
      .array(text(200))
      .min(3)
      .max(5)
      .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'duplicate_option'),
    correct: z.number().int().nonnegative(),
    explanation: explanation(),
  })
  .strict()
  .refine((c) => c.correct < c.options.length, { path: ['correct'], message: 'correct_out_of_range' });

/** Cada tipo de LD §1 define sus Cards (`cardOrdinals`) y su `toRating()` (LD2). */
export const NoteContentSchema = z.discriminatedUnion('kind', [
  BasicContentSchema,
  ClozeContentSchema,
  TypeAnswerContentSchema,
  MultipleChoiceContentSchema,
]);
export type NoteContent = z.infer<typeof NoteContentSchema>;

export const NoteSchema = SyncMetaSchema.extend({
  deckId: z.uuid(),
  /** Tema del mismo mazo (P4, LD5); null si no tiene. */
  topicId: z.uuid().nullable(),
  content: NoteContentSchema,
  /** LD16: `ai` solo al aceptar un borrador revisado por ella. */
  origin: z.enum(['manual', 'ai']),
}).strict();
export type Note = z.infer<typeof NoteSchema>;

export const CardSchema = SyncMetaSchema.extend({
  noteId: z.uuid(),
  /** Lado o hueco dentro de la nota: en `basic`, 0 es el frente y 1 la inversa. */
  ordinal: z.number().int().nonnegative(),
  /** Inicio de su estado FSRS: ordena las nuevas por creación. */
  createdAt: z.number().int().nonnegative(),
  /** P3: lapsos que tenía al reformularla; solo cuentan los posteriores. */
  lapseBaseline: z.number().int().nonnegative(),
}).strict();
export type Card = z.infer<typeof CardSchema>;

/** Cards que genera cada contenido (LD §1): lados en `basic`, números de hueco en `cloze`. */
export function cardOrdinals(content: NoteContent): number[] {
  switch (content.kind) {
    case 'basic':
      return content.reverse ? [0, 1] : [0];
    case 'cloze':
      return clozeNumbers(content.text);
    case 'type_answer':
    case 'multiple_choice':
      return [0];
  }
}

export type ClozeSegment =
  | { readonly kind: 'text'; readonly text: string }
  /** El hueco de esta Card: antes de revelar, su pista o nada; después, la respuesta. */
  | { readonly kind: 'blank'; readonly answer: string; readonly hint: string | null };

/** El texto de una nota `cloze` para la Card `ordinal`: los otros huecos se ven completos. */
export function clozeSegments(text: string, ordinal: number): ClozeSegment[] {
  const out: ClozeSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(CLOZE)) {
    const at = m.index;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    const answer = m[2] ?? '';
    const hint = m[3]?.trim() ?? ''; // `{{c1::x::}}` no tiene pista
    if (Number(m[1]) === ordinal) out.push({ kind: 'blank', answer, hint: hint === '' ? null : hint });
    else out.push({ kind: 'text', text: answer });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

const LETTERS = 'abcde';

/**
 * Lo que ve ella en el prompt y al revelar, como texto (R1, R4). La sesión de repaso muestra
 * cada tipo con su propio control; esto sirve para simulacros, listas y vistas previas.
 */
export function cardFaces(content: NoteContent, ordinal: number): { prompt: string; answer: string } {
  switch (content.kind) {
    case 'basic':
      return ordinal === 1
        ? { prompt: content.back, answer: content.front }
        : { prompt: content.front, answer: content.back };
    case 'cloze': {
      const segments = clozeSegments(content.text, ordinal);
      const join = (blank: (s: Extract<ClozeSegment, { kind: 'blank' }>) => string) =>
        segments.map((s) => (s.kind === 'text' ? s.text : blank(s))).join('');
      return { prompt: join((s) => `[${s.hint ?? '…'}]`), answer: join((s) => s.answer) };
    }
    case 'type_answer':
      return { prompt: content.front, answer: content.back };
    case 'multiple_choice': {
      const options = content.options.map((o, i) => `${LETTERS[i] ?? '?'}) ${o}`);
      return {
        prompt: [content.question, ...options].join('\n'),
        answer: options[content.correct] ?? '',
      };
    }
  }
}

// Espacio de nombres fijo para los IDs de Card. No cambiar: los ReviewLog ya guardados los
// referencian.
const CARD_NAMESPACE = 'b3d1a6e2-7c4f-4e8a-9f0b-5d2c8e1a4b7f';

/**
 * ID determinista (SYNC §1), como `settingsRowId`: dos dispositivos sin red que generan el
 * mismo lado de la misma nota escriben la misma fila y LWW la resuelve, en vez de duplicarla.
 */
export const cardIdFor = (noteId: string, ordinal: number): string =>
  uuidv5(`${noteId}:${ordinal}`, CARD_NAMESPACE);
