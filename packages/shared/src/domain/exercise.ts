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
