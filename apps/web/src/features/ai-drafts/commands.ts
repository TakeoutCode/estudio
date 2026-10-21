import {
  type AiDraft,
  aiDraftToNoteContent,
  type AiDraftResponse,
  AiDraftResponseSchema,
  AiDraftSchema,
  type AiNoteDraft,
  AiNoteDraftSchema,
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

/** El pedido a la API (con red); en las pruebas se reemplaza. */
export type AiDraftsRequester = (sourceText: string) => Promise<AiDraftResponse>;

const requestFromApi: AiDraftsRequester = (sourceText) =>
  authorizedApi('/ai/drafts', { method: 'POST', body: { sourceText }, schema: AiDraftResponseSchema });

async function writeDraft(database: EstudioDb, draft: Omit<AiDraft, 'hlc' | 'updatedAt'>, now: number) {
  const hlc = await nextHlc(database, now);
  const row = AiDraftSchema.parse({ ...draft, hlc, updatedAt: hlcWall(hlc) });
  await writeAndQueue(database, 'aiDraft', row, now);
  return row;
}

/**
 * LD14, LD16: pide borradores para el mazo y los guarda como AiDraft para que ella los revise;
 * nada se vuelve nota aquí. Cada uno queda marcado si su cita está literal en su texto. Lanza
 * el error de la API tal cual (cuota, sin red, IA no disponible) y su texto no se toca.
 */
export async function requestAiDrafts(
  deckId: string,
  sourceText: string,
  {
    database = defaultDb,
    now = Date.now(),
    request = requestFromApi,
  }: CommandOptions & { readonly request?: AiDraftsRequester } = {},
): Promise<{ readonly saved: number; readonly discarded: number }> {
  const { drafts, discarded } = await request(sourceText);
  await database.transaction('rw', [database.aiDrafts, database.outbox, database.meta], async () => {
    for (const draft of drafts) {
      await writeDraft(
        database,
        {
          id: newId(),
          deletedAt: null,
          kind: 'note',
          deckId,
          draft,
          supported: isQuoteInSource(sourceText, draft.sourceQuote),
          edited: false,
          status: 'draft',
          noteId: null,
          createdAt: now,
        },
        now,
      );
    }
  });
  syncScheduler.poke();
  return { saved: drafts.length, discarded };
}

const sameDraft = (a: AiNoteDraft, b: AiNoteDraft) => JSON.stringify(a) === JSON.stringify(b);

async function current(database: EstudioDb, id: string): Promise<AiDraft> {
  const draft = await database.aiDrafts.get(id);
  if (draft?.deletedAt !== null) throw new Error('ai_draft_not_found');
  return draft;
}

/** LD16: ella edita el borrador; un cambio real lo marca editado (y ya se puede aceptar). */
export async function editAiDraft(
  id: string,
  edited: AiNoteDraft,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<AiDraft> {
  const draft = AiNoteDraftSchema.parse(edited);
  const saved = await database.transaction(
    'rw',
    [database.aiDrafts, database.outbox, database.meta],
    async () => {
      const row = await current(database, id);
      if (row.status !== 'draft') throw new Error('ai_draft_closed');
      if (sameDraft(row.draft, draft)) return row;
      return writeDraft(database, { ...row, draft, edited: true }, now);
    },
  );
  syncScheduler.poke();
  return saved;
}

/**
 * LD16: aceptarlo crea la nota (`origin: 'ai'`) en su mazo y la deja enlazada, en una sola
 * transacción: un doble toque no crea dos. Sin respaldo y sin editar no se acepta.
 */
export async function acceptAiDraft(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<AiDraft> {
  const saved = await database.transaction('rw', [...noteTables(database), database.aiDrafts], async () => {
    const row = await current(database, id);
    if (!canAcceptAiDraft(row)) throw new Error('ai_draft_not_acceptable');
    const content = aiDraftToNoteContent(row.draft);
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
