import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

// Sets de contraste (STUDY-METHODS R9, P4; LEARNING-DESIGN LD10). Un grupo son notas que ella
// marcó porque se confunden entre sí (p. ej. nervios craneales). LWW (SYNC §1).

/** LD10: con sets de contraste, o mezcladas como siempre para comparar. */
export const ContrastArmSchema = z.enum(['contrast', 'control']);
export type ContrastArm = z.infer<typeof ContrastArmSchema>;

/** Límites del grupo (técnicos: un set nunca muestra más que `contrast.maxSetSize`). */
export const CONTRAST_MEMBERS = { min: 2, max: 20 } as const;

export const ContrastGroupSchema = SyncMetaSchema.extend({
  name: z.string().trim().min(1).max(120),
  /** Las notas que se confunden; sus Cards forman el set. */
  noteIds: z
    .array(z.uuid())
    .min(CONTRAST_MEMBERS.min)
    .max(CONTRAST_MEMBERS.max)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate_note'),
  /** LD10: semilla del sorteo, guardada para poder auditarlo; no cambia al editar el grupo. */
  abSeed: z.number().int().min(0).max(0xffff_ffff),
  abArm: ContrastArmSchema,
}).strict();
export type ContrastGroup = z.infer<typeof ContrastGroupSchema>;
