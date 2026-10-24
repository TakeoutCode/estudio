import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';
import { CLINICAL_QUESTIONS, type ClinicalCaseContent, ClinicalCaseContentSchema } from './exercise.js';
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

/** Casos por pedido: cada uno trae varias subpreguntas que revisar. Límite de diseño. */
export const AI_CASES_MAX = 5;

/**
 * LD15: una subpregunta de un caso. `answer` es la opción correcta tal cual (`multiple_choice`),
 * la respuesta breve (`type_answer`) o la clave (`open`); `options` solo en `multiple_choice`.
 */
export const AiClinicalQuestionDraftSchema = z
  .object({
    type: z.enum(['multiple_choice', 'type_answer', 'open']),
    question: z.string().trim().min(1).max(1000),
    answer: z.string().trim().min(1).max(2000),
    options: z.array(z.string().trim().min(1).max(200)).min(3).max(5).nullable(),
  })
  .strict();
export type AiClinicalQuestionDraft = z.infer<typeof AiClinicalQuestionDraftSchema>;

/** LD14, LD15: un borrador de caso clínico (LD §2) con la cita de su texto que lo respalda. */
export const AiClinicalCaseDraftSchema = z
  .object({
    vignette: z.string().trim().min(1).max(3000),
    questions: z.array(AiClinicalQuestionDraftSchema).min(CLINICAL_QUESTIONS.min).max(CLINICAL_QUESTIONS.max),
    explanation: z.string().trim().max(400), // R4
    /** Debe aparecer literal en el texto de entrada (LD16). */
    sourceQuote: z.string().trim().min(1).max(300),
  })
  .strict();
export type AiClinicalCaseDraft = z.infer<typeof AiClinicalCaseDraftSchema>;

/** `POST /ai/clinical-cases`: los borradores válidos y cuántos se descartaron (LD17). */
export const AiClinicalCasesResponseSchema = z
  .object({
    drafts: z.array(AiClinicalCaseDraftSchema).max(AI_CASES_MAX),
    discarded: z.number().int().nonnegative(),
  })
  .strict();
export type AiClinicalCasesResponse = z.infer<typeof AiClinicalCasesResponseSchema>;

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * El caso clínico que sale de un borrador, o null si no forma uno válido (una opción múltiple
 * sin la correcta entre sus opciones, una respuesta breve de más de 200 caracteres). Las
 * subpreguntas se numeran desde 1, como en un caso nuevo.
 */
export function aiClinicalCaseToNoteContent(draft: AiClinicalCaseDraft): ClinicalCaseContent | null {
  const questions = draft.questions.map((q, i) => {
    const n = i + 1;
    if (q.type === 'multiple_choice') {
      const options = q.options ?? [];
      return {
        n,
        type: q.type,
        question: q.question,
        options,
        correct: options.findIndex((o) => sameText(o, q.answer)),
      };
    }
    return q.type === 'type_answer'
      ? { n, type: q.type, question: q.question, answer: q.answer }
      : { n, type: q.type, question: q.question, key: q.answer };
  });
  const parsed = ClinicalCaseContentSchema.safeParse({
    kind: 'clinical_case',
    vignette: draft.vignette,
    questions,
    explanation: draft.explanation,
  });
  return parsed.success ? parsed.data : null;
}

/** Distractores por pedido: con la correcta llenan las 5 opciones de LD §1. */
export const AI_DISTRACTORS_MAX = 4;

/**
 * `POST /ai/distractors`: la pregunta y su opción correcta, las otras opciones que ella ya
 * escribió (para no repetirlas) y, en un caso clínico, la viñeta.
 */
export const AiDistractorsRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    correct: z.string().trim().min(1).max(200),
    existing: z.array(z.string().trim().min(1).max(200)).max(AI_DISTRACTORS_MAX),
    context: z.string().trim().min(1).max(3000).nullable(),
  })
  .strict();
export type AiDistractorsRequest = z.infer<typeof AiDistractorsRequestSchema>;

/** LD15: distractores, sin repetir la correcta ni lo que ya escribió. */
export const AiDistractorsResponseSchema = z
  .object({ distractors: z.array(z.string().trim().min(1).max(200)).min(1).max(AI_DISTRACTORS_MAX) })
  .strict();
export type AiDistractorsResponse = z.infer<typeof AiDistractorsResponseSchema>;

/** Lo propuesto que sirve: distinto de la correcta, de lo que ya escribió y entre sí. */
export function usableDistractors(
  proposed: readonly string[],
  request: Pick<AiDistractorsRequest, 'correct' | 'existing'>,
): string[] {
  const taken = [request.correct, ...request.existing];
  const out: string[] = [];
  for (const raw of proposed) {
    const option = raw.trim();
    if (option === '' || option.length > 200) continue;
    if ([...taken, ...out].some((t) => sameText(t, option))) continue;
    out.push(option);
  }
  return out.slice(0, AI_DISTRACTORS_MAX);
}

/** LD16: los distractores que la IA propuso para una pregunta; ella elige cuáles usa. */
export const AiDistractorsDraftSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    correct: z.string().trim().min(1).max(200),
    distractors: z.array(z.string().trim().min(1).max(200)).min(1).max(AI_DISTRACTORS_MAX),
  })
  .strict();
export type AiDistractorsDraft = z.infer<typeof AiDistractorsDraftSchema>;

const AiDraftBaseSchema = SyncMetaSchema.extend({
  /** El mazo donde ella pidió los borradores. */
  deckId: z.uuid(),
  /** LD16: la cita estaba literal en el texto; si no, se acepta solo editado. Distractores: sin cita, `true`. */
  supported: z.boolean(),
  edited: z.boolean(),
  status: z.enum(['draft', 'accepted', 'rejected']),
  noteId: z.uuid().nullable(),
  createdAt: z.number().int().nonnegative(),
});

/**
 * LD16: lo generado, guardado como borrador (LWW, SYNC §1); nunca se acepta solo. Aceptar una
 * nota o un caso clínico crea la nota con `origin: 'ai'` y guarda su id. Los distractores no
 * crean nota: ella elige en el editor cuáles pasan a sus opciones (`accepted`, sin `noteId`,
 * porque la pregunta y la correcta son suyas) o los descarta (`rejected`).
 */
export const AiDraftSchema = z.discriminatedUnion('kind', [
  AiDraftBaseSchema.extend({ kind: z.literal('note'), draft: AiNoteDraftSchema }).strict(),
  AiDraftBaseSchema.extend({ kind: z.literal('clinical_case'), draft: AiClinicalCaseDraftSchema }).strict(),
  AiDraftBaseSchema.extend({ kind: z.literal('distractors'), draft: AiDistractorsDraftSchema }).strict(),
]);
export type AiDraft = z.infer<typeof AiDraftSchema>;
/** Los borradores que se revisan en la pantalla de un mazo y, al aceptarlos, crean una nota. */
export type AiNoteLikeDraft = Extract<AiDraft, { kind: 'note' | 'clinical_case' }>;

/** LD16: sin respaldo y sin editar no se puede aceptar. */
export const canAcceptAiDraft = (draft: Pick<AiDraft, 'supported' | 'edited' | 'status'>): boolean =>
  draft.status === 'draft' && (draft.supported || draft.edited);

/** LD15: cuántos puntos por lista; más no se lee con calma. Límite de diseño. */
export const AI_FEEDBACK_POINTS_MAX = 8;
const feedbackPoint = z.string().trim().min(1).max(300);

/**
 * LD15: retroalimentación de una respuesta abierta frente a su clave. Sin nota numérica: la
 * calificación es de ella (LD14).
 */
export const AiOpenFeedbackSchema = z
  .object({
    covered: z.array(feedbackPoint).max(AI_FEEDBACK_POINTS_MAX),
    missing: z.array(feedbackPoint).max(AI_FEEDBACK_POINTS_MAX),
    misconceptions: z.array(feedbackPoint).max(AI_FEEDBACK_POINTS_MAX),
    suggestion: z.string().trim().max(500),
  })
  .strict();
export type AiOpenFeedback = z.infer<typeof AiOpenFeedbackSchema>;

/** `POST /ai/feedback`: la pregunta (en un caso clínico, con la viñeta), su clave y lo que escribió. */
export const AiFeedbackRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(8000),
    key: z.string().trim().min(1).max(2000),
    answer: z.string().trim().min(1).max(2000),
  })
  .strict();
export type AiFeedbackRequest = z.infer<typeof AiFeedbackRequestSchema>;

/** Si su autoexplicación tras un fallo es correcta (decisión del responsable, 2026-10-23). */
export const AiExplanationVerdictSchema = z.enum(['correct', 'partial', 'incorrect']);
export type AiExplanationVerdict = z.infer<typeof AiExplanationVerdictSchema>;

/**
 * LD14: lo que dice la IA de su autoexplicación de una tarjeta que olvidó, frente a la respuesta
 * y la explicación de la tarjeta. El veredicto no toca FSRS: la calificación ya es suya.
 */
export const AiExplanationCheckSchema = z
  .object({
    verdict: AiExplanationVerdictSchema,
    missing: z.array(feedbackPoint).max(AI_FEEDBACK_POINTS_MAX),
    misconceptions: z.array(feedbackPoint).max(AI_FEEDBACK_POINTS_MAX),
    suggestion: z.string().trim().max(500),
  })
  .strict();
export type AiExplanationCheck = z.infer<typeof AiExplanationCheckSchema>;

/** `POST /ai/explanation-check`: la pregunta, la clave (respuesta y explicación) y lo que escribió. */
export const AiExplanationCheckRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(8000),
    key: z.string().trim().min(1).max(2000),
    explanation: z.string().trim().min(1).max(2000),
  })
  .strict();
export type AiExplanationCheckRequest = z.infer<typeof AiExplanationCheckRequestSchema>;

/** Lo que se guarda de esa revisión: el veredicto y su texto, para volver a verlo. */
export const AiLapseExplanationSchema = AiExplanationCheckSchema.extend({
  explanation: z.string().trim().min(1).max(2000),
}).strict();
export type AiLapseExplanation = z.infer<typeof AiLapseExplanationSchema>;

/**
 * La retroalimentación que pidió para una tarjeta (solo inserción, SYNC §1): de una respuesta
 * abierta o, desde el contrato 28, de su autoexplicación tras un fallo.
 */
export const AiFeedbackSchema = z
  .object({
    id: z.uuid(),
    cardId: z.uuid(),
    requestedAt: z.number().int().nonnegative(),
    feedback: z.union([AiOpenFeedbackSchema, AiLapseExplanationSchema]),
  })
  .strict();
export type AiFeedback = z.infer<typeof AiFeedbackSchema>;
