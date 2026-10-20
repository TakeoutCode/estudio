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

/** Los demás tipos de LD §1 se agregan aquí, cada uno con sus Cards y su `toRating()` (LD2). */
export const NoteContentSchema = z.discriminatedUnion('kind', [BasicContentSchema]);
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

/** Lados que genera cada contenido (LD §1). */
export function cardOrdinals(content: NoteContent): number[] {
  return content.reverse ? [0, 1] : [0];
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

/** Lo que ve ella en el prompt y al revelar, según el lado (R1, R4). */
export function cardFaces(content: NoteContent, ordinal: number): { prompt: string; answer: string } {
  return ordinal === 1
    ? { prompt: content.back, answer: content.front }
    : { prompt: content.front, answer: content.back };
}
