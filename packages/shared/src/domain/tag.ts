import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

// Etiquetas (*diseño*, LEARNING-DESIGN §1 y §6). Son de ella y cruzan mazos: cada nota guarda
// las suyas en `Note.tagIds`. Sirven para filtrar y para estudiar solo las de una etiqueta.
// LWW (SYNC §1).

export const TAG_NAME_MAX_LENGTH = 60;
/** Límite técnico, no de estudio: una nota no necesita más. */
export const TAGS_PER_NOTE_MAX = 20;

export const TagSchema = SyncMetaSchema.extend({
  name: z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH),
}).strict();
export type Tag = z.infer<typeof TagSchema>;

/** Dos nombres que solo difieren en mayúsculas, acentos o espacios son la misma etiqueta. */
export const tagKey = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Las etiquetas de una nota: sin repetir, hasta `TAGS_PER_NOTE_MAX`. */
export const NoteTagIdsSchema = z
  .array(z.uuid())
  .max(TAGS_PER_NOTE_MAX)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate_tag');
