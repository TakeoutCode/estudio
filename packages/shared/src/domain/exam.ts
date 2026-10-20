import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

// Exámenes (STUDY-METHODS R11, P7; LEARNING-DESIGN LD11-LD13). LWW (SYNC §1).

export const ExamSchema = SyncMetaSchema.extend({
  title: z.string().trim().min(1).max(120),
  /** R11: inicio del día del examen en su zona horaria (AG6), epoch ms. */
  date: z.number().int().nonnegative(),
  /** LD11: temas que entran; el plan y los simulacros salen de aquí. */
  topicIds: z
    .array(z.uuid())
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate_topic'),
}).strict();
export type Exam = z.infer<typeof ExamSchema>;
