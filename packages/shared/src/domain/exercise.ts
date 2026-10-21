import { z } from 'zod';
import { explanation, type OcclusionGroup, OcclusionGroupSchema, text } from './content-parts.js';
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

/** Límites de etiquetar una imagen (técnicos: lo que se escribe cómodo en el teléfono). */
export const LABEL_IMAGE_LABELS = { min: 2, max: 20 } as const;

/**
 * `label_image` (R10, LD1): una imagen suya con sus etiquetas tapadas y numeradas; ella escribe
 * el nombre de cada una. Es una sola Card y el puntaje es etiquetas correctas / total (LD §2).
 */
export const LabelImageContentSchema = z
  .object({
    kind: z.literal('label_image'),
    /** FE8: el asset, nunca una URL. */
    imageAssetId: z.uuid(),
    /** LD1: el texto que acompaña la imagen ("Nombra los huesos del carpo"). */
    prompt: text(500),
    /** UX4: describe la estructura sin dar ninguna respuesta. */
    alt: text(300),
    labels: z
      .array(OcclusionGroupSchema)
      .min(LABEL_IMAGE_LABELS.min)
      .max(LABEL_IMAGE_LABELS.max)
      .refine((labels) => new Set(labels.map((l) => l.n)).size === labels.length, 'duplicate_label'),
    explanation: explanation(),
  })
  .strict();
export type LabelImageContent = z.infer<typeof LabelImageContentSchema>;

/** Las etiquetas en el orden en que se numeran en pantalla (1, 2, …). */
export const numberedLabels = (content: LabelImageContent): OcclusionGroup[] =>
  [...content.labels].sort((a, b) => a.n - b.n);

/** Límites de un caso clínico (técnicos: lo que se responde en una sentada). */
export const CLINICAL_QUESTIONS = { min: 1, max: 6 } as const;

/** El número estable de la subpregunta: es el `ordinal` de su Card y no se reutiliza. */
const questionNumber = () => z.number().int().min(1).max(99);

/**
 * Una subpregunta del caso; cada una es una Card y se intenta y califica como su tipo (LD2):
 * opción múltiple y escribir la respuesta son objetivas; la abierta la califica ella.
 */
export const ClinicalQuestionSchema = z.discriminatedUnion('type', [
  z
    .object({
      n: questionNumber(),
      type: z.literal('multiple_choice'),
      question: text(1000),
      options: z
        .array(text(200))
        .min(3)
        .max(5)
        .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'duplicate_option'),
      correct: z.number().int().nonnegative(),
    })
    .strict()
    .refine((q) => q.correct < q.options.length, { path: ['correct'], message: 'correct_out_of_range' }),
  z
    .object({ n: questionNumber(), type: z.literal('type_answer'), question: text(1000), answer: text(200) })
    .strict(),
  z.object({ n: questionNumber(), type: z.literal('open'), question: text(1000), key: text(2000) }).strict(),
]);
export type ClinicalQuestion = z.infer<typeof ClinicalQuestionSchema>;

/**
 * `clinical_case`: un caso (la viñeta) y sus subpreguntas, una Card por cada una (LD §2). La
 * viñeta se muestra con cada subpregunta; quitar una subpregunta borra solo su Card.
 */
export const ClinicalCaseContentSchema = z
  .object({
    kind: z.literal('clinical_case'),
    vignette: text(3000),
    questions: z
      .array(ClinicalQuestionSchema)
      .min(CLINICAL_QUESTIONS.min)
      .max(CLINICAL_QUESTIONS.max)
      .refine((qs) => new Set(qs.map((q) => q.n)).size === qs.length, 'duplicate_question'),
    explanation: explanation(),
  })
  .strict();
export type ClinicalCaseContent = z.infer<typeof ClinicalCaseContentSchema>;

/** La subpregunta de la Card `ordinal`, y su posición entre todas ("2 de 3"). */
export function clinicalQuestion(
  content: ClinicalCaseContent,
  ordinal: number,
): { readonly question: ClinicalQuestion; readonly position: number; readonly total: number } | null {
  const sorted = [...content.questions].sort((a, b) => a.n - b.n);
  const index = sorted.findIndex((q) => q.n === ordinal);
  const question = sorted[index];
  return question ? { question, position: index + 1, total: sorted.length } : null;
}

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
