import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

// Temas (LEARNING-DESIGN §1 y LD5; STUDY-METHODS R5, P4). Un tema agrupa notas de un mazo y
// lleva la explicación del concepto, que se muestra antes de su primera tarjeta nueva para
// separar entender de recordar. Ambos son LWW (SYNC §1).

export const TOPIC_EXPLANATION_MAX_LENGTH = 2000;
export const SELF_EXPLANATION_MAX_LENGTH = 4000;

export const TopicSchema = SyncMetaSchema.extend({
  deckId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  /** R5, LD5: puede quedar vacía; entonces solo se pide la autoexplicación. */
  explanation: z.string().trim().max(TOPIC_EXPLANATION_MAX_LENGTH),
}).strict();
export type Topic = z.infer<typeof TopicSchema>;

/** LD5: "Explícalo con tus palabras". No es un repaso (R15): no genera ReviewLog. */
export const SelfExplanationSchema = SyncMetaSchema.extend({
  topicId: z.uuid(),
  text: z.string().trim().min(1).max(SELF_EXPLANATION_MAX_LENGTH),
  /** Cuándo la escribió; `updatedAt` cambia si después la edita. */
  writtenAt: z.number().int().nonnegative(),
}).strict();
export type SelfExplanation = z.infer<typeof SelfExplanationSchema>;
