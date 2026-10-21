import { z } from 'zod';
import { explanation, text } from './content-parts.js';
import { type CardKind, type ExerciseKind, ExerciseKindSchema } from './review.js';

// Ejercicios de aplicación (LEARNING-DESIGN §2). Son tipos de nota con su propio editor: viven
// en un mazo, con tema y etiquetas, y generan Cards como cualquier nota (LD §1). Su intento y su
// calificación salen de `toRating()` en srs (LD2).

/** Los tipos de §2: el resto de los de `NoteContent` son tarjetas (LD §1). */
export const isExerciseKind = (kind: CardKind): kind is ExerciseKind =>
  (ExerciseKindSchema.options as readonly string[]).includes(kind);

/**
 * `true_false_justify`: una afirmación que ella juzga y justifica. El V/F se califica solo; la
 * justificación la compara ella con la de referencia (LD2).
 */
export const TrueFalseJustifyContentSchema = z
  .object({
    kind: z.literal('true_false_justify'),
    statement: text(2000),
    /** La afirmación es verdadera. */
    isTrue: z.boolean(),
    /** La justificación de referencia: lo que tendría que decir la suya. */
    justification: text(1000),
    explanation: explanation(),
  })
  .strict();
export type TrueFalseJustifyContent = z.infer<typeof TrueFalseJustifyContentSchema>;

/** Límites de una secuencia (técnicos: lo que cabe ordenar en el teléfono). */
export const SEQUENCE_ITEMS = { min: 3, max: 10 } as const;

/**
 * `sequence`: pasos o estructuras en su orden correcto (p. ej. capas de la piel de superficial a
 * profunda). Se muestran mezclados y el puntaje es Kendall (LD §2).
 */
export const SequenceContentSchema = z
  .object({
    kind: z.literal('sequence'),
    /** La consigna: qué ordenar y en qué sentido. */
    prompt: text(500),
    /** En el orden correcto. */
    items: z
      .array(text(200))
      .min(SEQUENCE_ITEMS.min)
      .max(SEQUENCE_ITEMS.max)
      .refine((items) => new Set(items.map((i) => i.toLowerCase())).size === items.length, 'duplicate_item'),
    explanation: explanation(),
  })
  .strict();
export type SequenceContent = z.infer<typeof SequenceContentSchema>;

/** Límites de relacionar columnas (técnicos: lo que cabe en el teléfono). */
export const MATCHING_PAIRS = { min: 3, max: 8 } as const;

const distinct = (values: readonly string[]) =>
  new Set(values.map((v) => v.toLowerCase())).size === values.length;

/**
 * `matching`: relacionar cada elemento de la columna A con el suyo de la B (p. ej. músculo e
 * inervación). El puntaje es pares correctos / total (LD §2).
 */
export const MatchingContentSchema = z
  .object({
    kind: z.literal('matching'),
    prompt: text(500),
    pairs: z
      .array(z.object({ left: text(200), right: text(200) }).strict())
      .min(MATCHING_PAIRS.min)
      .max(MATCHING_PAIRS.max)
      .refine((pairs) => distinct(pairs.map((p) => p.left)), 'duplicate_left')
      .refine((pairs) => distinct(pairs.map((p) => p.right)), 'duplicate_right'),
    explanation: explanation(),
  })
  .strict();
export type MatchingContent = z.infer<typeof MatchingContentSchema>;

/** `open_question`: escribe su respuesta y se califica al compararla con la clave (LD2). */
export const OpenQuestionContentSchema = z
  .object({
    kind: z.literal('open_question'),
    question: text(2000),
    /** La clave: lo que una buena respuesta tendría que cubrir. */
    key: text(2000),
    explanation: explanation(),
  })
  .strict();
export type OpenQuestionContent = z.infer<typeof OpenQuestionContentSchema>;
