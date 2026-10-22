import {
  type AiClinicalCaseDraft,
  AiClinicalCaseDraftSchema,
  AiClinicalCasesResponseSchema,
  aiClinicalCaseToNoteContent,
  type AiDistractorsRequest,
  type AiDistractorsResponse,
  AiDistractorsResponseSchema,
  type AiDraft,
  aiDraftToNoteContent,
  AiDraftResponseSchema,
  AiDraftSchema,
  type AiFeedbackRequest,
  AiFeedbackSchema,
  type AiNoteDraft,
  AiNoteDraftSchema,
  type AiNoteLikeDraft,
  type AiOpenFeedback,
  AiOpenFeedbackSchema,
  canAcceptAiDraft,
  isQuoteInSource,
  newId,
} from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { authorizedApi } from '@/features/auth';
import { createNote, noteTables } from '@/features/notes';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/** Lo que se le puede pedir desde un mazo (LD14): tarjetas o casos clínicos. */
export type AiDraftsKind = AiNoteLikeDraft['kind'];

export type AiDraftsAnswer =
  | { readonly kind: 'note'; readonly drafts: readonly AiNoteDraft[]; readonly discarded: number }
  | {
      readonly kind: 'clinical_case';
      readonly drafts: readonly AiClinicalCaseDraft[];
      readonly discarded: number;
    };

/** El pedido a la API (con red); en las pruebas se reemplaza. */
export type AiDraftsRequester = (kind: AiDraftsKind, sourceText: string) => Promise<AiDraftsAnswer>;

const requestFromApi: AiDraftsRequester = async (kind, sourceText) => {
  const body = { sourceText };
  return kind === 'note'
    ? {
        kind,
        ...(await authorizedApi('/ai/drafts', { method: 'POST', body, schema: AiDraftResponseSchema })),
      }
    : {
        kind,
        ...(await authorizedApi('/ai/clinical-cases', {
          method: 'POST',
          body,
          schema: AiClinicalCasesResponseSchema,
        })),
      };
};

/** `Omit` de cada variante (el de TS sobre una unión pierde la relación entre `kind` y `draft`). */
type DraftFields = AiDraft extends infer D
  ? D extends AiDraft
    ? Omit<D, 'hlc' | 'updatedAt'>
    : never
  : never;

async function writeDraft(database: EstudioDb, draft: DraftFields, now: number): Promise<AiDraft> {
  const hlc = await nextHlc(database, now);
  const row = AiDraftSchema.parse({ ...draft, hlc, updatedAt: hlcWall(hlc) });
  await writeAndQueue(database, 'aiDraft', row, now);
  return row;
}

const fresh = (deckId: string, now: number) =>
  ({
    id: newId(),
    deletedAt: null,
    deckId,
    edited: false,
    status: 'draft',
    noteId: null,
    createdAt: now,
  }) as const;

/**
 * LD14, LD16: pide borradores de tarjetas o de casos clínicos para el mazo y los guarda como
 * AiDraft para que ella los revise; nada se vuelve nota aquí. Cada uno queda marcado si su cita
 * está literal en su texto. Lanza el error de la API tal cual (cuota, sin red, IA no
 * disponible) y su texto no se toca.
 */
export async function requestAiDrafts(
  deckId: string,
  sourceText: string,
  {
    database = defaultDb,
    now = Date.now(),
    kind = 'note',
    request = requestFromApi,
  }: CommandOptions & { readonly kind?: AiDraftsKind; readonly request?: AiDraftsRequester } = {},
): Promise<{ readonly saved: number; readonly discarded: number }> {
  const answer = await request(kind, sourceText);
  await database.transaction('rw', [database.aiDrafts, database.outbox, database.meta], async () => {
    const supported = (quote: string) => isQuoteInSource(sourceText, quote);
    if (answer.kind === 'note') {
      for (const draft of answer.drafts) {
        const row = {
          ...fresh(deckId, now),
          kind: 'note',
          draft,
          supported: supported(draft.sourceQuote),
        } as const;
        await writeDraft(database, row, now);
      }
    } else {
      for (const draft of answer.drafts) {
        const row = {
          ...fresh(deckId, now),
          kind: 'clinical_case',
          draft,
          supported: supported(draft.sourceQuote),
        } as const;
        await writeDraft(database, row, now);
      }
    }
  });
  syncScheduler.poke();
  return { saved: answer.drafts.length, discarded: answer.discarded };
}

async function current(database: EstudioDb, id: string): Promise<AiDraft> {
  const draft = await database.aiDrafts.get(id);
  if (draft?.deletedAt !== null) throw new Error('ai_draft_not_found');
  return draft;
}

/** El borrador con lo que ella escribió, validado con el esquema de su tipo. */
function withEdit(row: AiDraft, edited: AiNoteDraft | AiClinicalCaseDraft): AiNoteLikeDraft {
  if (row.kind === 'note') return { ...row, draft: AiNoteDraftSchema.parse(edited) };
  if (row.kind === 'clinical_case') return { ...row, draft: AiClinicalCaseDraftSchema.parse(edited) };
  throw new Error('ai_draft_closed'); // los distractores se eligen en el editor, no se editan aquí
}

/** LD16: ella edita el borrador; un cambio real lo marca editado (y ya se puede aceptar). */
export async function editAiDraft(
  id: string,
  edited: AiNoteDraft | AiClinicalCaseDraft,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<AiDraft> {
  const saved = await database.transaction(
    'rw',
    [database.aiDrafts, database.outbox, database.meta],
    async () => {
      const row = await current(database, id);
      if (row.status !== 'draft') throw new Error('ai_draft_closed');
      const next = withEdit(row, edited);
      if (JSON.stringify(next.draft) === JSON.stringify(row.draft)) return row;
      return writeDraft(database, { ...next, edited: true }, now);
    },
  );
  syncScheduler.poke();
  return saved;
}

/**
 * LD16: aceptarlo crea la nota o el caso clínico (`origin: 'ai'`) en su mazo y lo deja
 * enlazado, en una sola transacción: un doble toque no crea dos. Sin respaldo y sin editar no
 * se acepta.
 */
export async function acceptAiDraft(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<AiDraft> {
  const saved = await database.transaction('rw', [...noteTables(database), database.aiDrafts], async () => {
    const row = await current(database, id);
    if (row.kind === 'distractors' || !canAcceptAiDraft(row)) throw new Error('ai_draft_not_acceptable');
    const content =
      row.kind === 'note' ? aiDraftToNoteContent(row.draft) : aiClinicalCaseToNoteContent(row.draft);
    if (!content) throw new Error('ai_draft_invalid');
    const note = await createNote({ deck: { id: row.deckId }, content, origin: 'ai' }, { database, now });
    return writeDraft(database, { ...row, status: 'accepted', noteId: note.id }, now);
  });
  syncScheduler.poke();
  return saved;
}

/** LD16: descartarlo lo deja como `rejected`; no se borra, como todo lo generado. */
export async function rejectAiDraft(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<void> {
  await database.transaction('rw', [database.aiDrafts, database.outbox, database.meta], async () => {
    const row = await current(database, id);
    if (row.status === 'draft') await writeDraft(database, { ...row, status: 'rejected' }, now);
  });
  syncScheduler.poke();
}

/** El pedido de distractores a la API (con red); en las pruebas se reemplaza. */
export type AiDistractorsRequester = (request: AiDistractorsRequest) => Promise<AiDistractorsResponse>;

const distractorsFromApi: AiDistractorsRequester = (request) =>
  authorizedApi('/ai/distractors', { method: 'POST', body: request, schema: AiDistractorsResponseSchema });

export type AiDistractorsDraft = Extract<AiDraft, { kind: 'distractors' }>;

/**
 * LD14, LD16: distractores para su pregunta, guardados como AiDraft. No tocan su nota: ella
 * elige en el editor cuáles pasan a sus opciones, y la nota se guarda cuando ella la guarda.
 * Sin cita que comprobar (son opciones incorrectas), van con `supported: true`.
 */
export async function requestAiDistractors(
  deckId: string,
  request: AiDistractorsRequest,
  {
    database = defaultDb,
    now = Date.now(),
    ask = distractorsFromApi,
  }: CommandOptions & { readonly ask?: AiDistractorsRequester } = {},
): Promise<AiDistractorsDraft> {
  const { distractors } = await ask(request);
  const row = {
    ...fresh(deckId, now),
    kind: 'distractors',
    draft: { question: request.question, correct: request.correct, distractors },
    supported: true,
  } as const;
  const saved = await database.transaction('rw', [database.aiDrafts, database.outbox, database.meta], () =>
    writeDraft(database, row, now),
  );
  syncScheduler.poke();
  if (saved.kind !== 'distractors') throw new Error('ai_draft_invalid');
  return saved;
}

/** LD16: usó al menos uno de los distractores en sus opciones; queda `accepted`. */
export async function markAiDistractorsUsed(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<void> {
  await database.transaction('rw', [database.aiDrafts, database.outbox, database.meta], async () => {
    const row = await current(database, id);
    if (row.kind === 'distractors' && row.status === 'draft') {
      await writeDraft(database, { ...row, status: 'accepted' }, now);
    }
  });
  syncScheduler.poke();
}

/** El pedido de retroalimentación a la API (con red); en las pruebas se reemplaza. */
export type AiFeedbackRequester = (request: AiFeedbackRequest) => Promise<AiOpenFeedback>;

const feedbackFromApi: AiFeedbackRequester = (request) =>
  authorizedApi('/ai/feedback', { method: 'POST', body: request, schema: AiOpenFeedbackSchema });

/**
 * LD14: retroalimentación de su respuesta abierta frente a su clave. Se guarda (solo inserción)
 * para poder volver a verla; no califica ni toca FSRS: la calificación sigue siendo de ella.
 */
export async function requestAiFeedback(
  cardId: string,
  request: AiFeedbackRequest,
  {
    database = defaultDb,
    now = Date.now(),
    ask = feedbackFromApi,
  }: CommandOptions & { readonly ask?: AiFeedbackRequester } = {},
): Promise<AiOpenFeedback> {
  const feedback = await ask(request);
  const row = AiFeedbackSchema.parse({ id: newId(), cardId, requestedAt: now, feedback });
  await database.transaction('rw', [database.aiFeedback, database.outbox, database.meta], () =>
    writeAndQueue(database, 'aiFeedback', row, now),
  );
  syncScheduler.poke();
  return feedback;
}
