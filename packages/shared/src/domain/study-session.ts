import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';
import { ConfidenceSchema } from './review.js';

// Simulacros (STUDY-METHODS P7; LEARNING-DESIGN LD13; BACKEND §1: un simulacro es una
// StudySession con `mode: 'exam'`). LWW: cada respuesta reescribe la fila, así se puede
// retomar al reabrir la app o en otro dispositivo. Los ReviewLog se escriben al calificar
// cada pregunta (R3).

const epochMs = () => z.number().int().nonnegative();

export const MOCK_ANSWER_MAX_LENGTH = 2000;

export const MockItemSchema = z
  .object({
    cardId: z.uuid(),
    topicId: z.uuid().nullable(),
    /** R6: obligatoria antes de seguir; null hasta responder. */
    confidence: ConfidenceSchema.nullable(),
    /** Lo que escribió; con retroalimentación al final, es lo que compara al revisar. */
    answer: z.string().max(MOCK_ANSWER_MAX_LENGTH).nullable(),
    /** De mostrar la pregunta a responderla (R3). */
    durationMs: z.number().int().nonnegative().nullable(),
    answeredAt: epochMs().nullable(),
    /** Ella marca si acertó al ver la respuesta (LD2, P7); null hasta calificar. */
    correct: z.boolean().nullable(),
  })
  .strict();
export type MockItem = z.infer<typeof MockItemSchema>;

export const StudySessionSchema = SyncMetaSchema.extend({
  mode: z.literal('exam'),
  examId: z.uuid(),
  /** P7: fijada al empezar con `exam.feedbackTiming`. */
  feedbackTiming: z.enum(['end', 'immediate']),
  items: z.array(MockItemSchema).min(1).max(200),
  startedAt: epochMs(),
  /** Todas calificadas; null mientras sigue. */
  finishedAt: epochMs().nullable(),
}).strict();
export type StudySession = z.infer<typeof StudySessionSchema>;
