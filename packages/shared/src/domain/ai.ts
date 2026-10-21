import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';
import { clozeNumbers, type NoteContent, NoteContentSchema } from './note.js';

// IA opcional (LEARNING-DESIGN §8): borradores que ella revisa y edita antes de aceptarlos. La
// IA nunca califica ni programa repasos (LD14) y nada se guarda como nota sin que ella acepte
// (LD16). La captura manual siempre existe.

/** LD17: lo más que se manda de una vez. Límite técnico y de costo, no de estudio. */
export const AI_INPUT_MAX_LENGTH = 12_000;
/** Borradores por pedido: más que esto no se revisa con calma. Límite de diseño. */
export const AI_DRAFTS_MAX = 20;

/**
 * LD15: un borrador de nota. `basic`: pregunta y respuesta. `cloze`: `front` es el texto con
 * `{{c1::…}}` y `back` lo que se oculta. `multiple_choice`: `front` es la pregunta, `back` la
 * opción correcta y `options` las 3 a 5 opciones, con la correcta incluida.
 */
export const AiNoteDraftSchema = z
  .object({
    kind: z.enum(['basic', 'cloze', 'multiple_choice']),
    front: z.string().trim().min(1).max(500),
    back: z.string().trim().min(1).max(1000),
    explanation: z.string().trim().max(400), // R4
    /** Debe aparecer literal en el texto de entrada (LD16). */
    sourceQuote: z.string().trim().min(1).max(300),
    options: z.array(z.string().trim().min(1).max(200)).min(3).max(5).nullable(),
  })
  .strict();
export type AiNoteDraft = z.infer<typeof AiNoteDraftSchema>;

/** `POST /ai/drafts`: el texto que ella pega (LD14). */
export const AiDraftRequestSchema = z
  .object({ sourceText: z.string().trim().min(1).max(AI_INPUT_MAX_LENGTH) })
  .strict();
export type AiDraftRequest = z.infer<typeof AiDraftRequestSchema>;

/** LD17: los ítems inválidos se descartan e informan. */
export const AiDraftResponseSchema = z
  .object({
    drafts: z.array(AiNoteDraftSchema).max(AI_DRAFTS_MAX),
    discarded: z.number().int().nonnegative(),
  })
  .strict();
export type AiDraftResponse = z.infer<typeof AiDraftResponseSchema>;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * LD16: la cita del borrador aparece literal en su texto. Solo se ignoran los espacios y las
 * mayúsculas; cualquier otra diferencia la deja "Sin respaldo en tu texto".
 */
export const isQuoteInSource = (sourceText: string, quote: string): boolean =>
  squash(quote).length > 0 && squash(sourceText).includes(squash(quote));

/**
 * El contenido de nota que sale de un borrador, o null si no forma una nota válida (un cloze
 * sin huecos, una opción múltiple sin la correcta entre sus opciones).
 */
export function aiDraftToNoteContent(draft: AiNoteDraft): NoteContent | null {
  const candidate =
    draft.kind === 'basic'
      ? {
          kind: 'basic',
          front: draft.front,
          back: draft.back,
          explanation: draft.explanation,
          reverse: false,
        }
      : draft.kind === 'cloze'
        ? { kind: 'cloze', text: draft.front, explanation: draft.explanation }
        : {
            kind: 'multiple_choice',
            question: draft.front,
            options: draft.options ?? [],
            correct: (draft.options ?? []).findIndex((o) => o.toLowerCase() === draft.back.toLowerCase()),
            explanation: draft.explanation,
          };
  if (draft.kind === 'cloze' && clozeNumbers(draft.front).length === 0) return null;
  const parsed = NoteContentSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * LD16: lo generado, guardado como borrador (LWW, SYNC §1). Aceptarlo crea la nota con
 * `origin: 'ai'` y guarda su id; nunca se acepta solo.
 */
export const AiDraftSchema = SyncMetaSchema.extend({
  kind: z.literal('note'),
  /** El mazo donde ella pidió los borradores. */
  deckId: z.uuid(),
  draft: AiNoteDraftSchema,
  /** LD16: la cita estaba literal en el texto; si no, se acepta solo después de editarlo. */
  supported: z.boolean(),
  edited: z.boolean(),
  status: z.enum(['draft', 'accepted', 'rejected']),
  noteId: z.uuid().nullable(),
  createdAt: z.number().int().nonnegative(),
}).strict();
export type AiDraft = z.infer<typeof AiDraftSchema>;

/** LD16: sin respaldo y sin editar no se puede aceptar. */
export const canAcceptAiDraft = (draft: Pick<AiDraft, 'supported' | 'edited' | 'status'>): boolean =>
  draft.status === 'draft' && (draft.supported || draft.edited);
