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

/**
 * `self`: "Explícalo con tus palabras" antes de la primera tarjeta nueva del tema (LD5).
 * `teach`: "Explícaselo a alguien" (técnica Feynman, STUDY-METHODS §1), cuando ella quiera.
 */
export const SelfExplanationKindSchema = z.enum(['self', 'teach']);
export type SelfExplanationKind = z.infer<typeof SelfExplanationKindSchema>;

/** LD5 y STUDY-METHODS §1. No es un repaso (R15): no genera ReviewLog. */
export const SelfExplanationSchema = SyncMetaSchema.extend({
  topicId: z.uuid(),
  /** Las guardadas antes del contrato 25 son todas `self`. */
  kind: SelfExplanationKindSchema.default('self'),
  text: z.string().trim().min(1).max(SELF_EXPLANATION_MAX_LENGTH),
  /** `teach`: lo que notó que le faltó al compararla con sus apuntes; opcional. */
  gaps: z.string().trim().min(1).max(SELF_EXPLANATION_MAX_LENGTH).nullable().default(null),
  /** Cuándo la escribió; `updatedAt` cambia si después la edita. */
  writtenAt: z.number().int().nonnegative(),
}).strict();
export type SelfExplanation = z.infer<typeof SelfExplanationSchema>;
