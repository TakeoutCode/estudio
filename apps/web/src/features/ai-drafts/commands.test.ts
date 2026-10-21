import { type AiNoteDraft, cardIdFor, MutationSchema } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createDeck } from '@/features/decks';
import { ApiError } from '@/lib/api';
import { acceptAiDraft, editAiDraft, rejectAiDraft, requestAiDrafts } from './commands';

const T0 = Date.UTC(2026, 9, 21, 15);
const SOURCE = 'El deltoides está inervado por el nervio axilar, que sale del fascículo posterior.';

const supported: AiNoteDraft = {
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: 'Sale del fascículo posterior.',
  sourceQuote: 'El deltoides está inervado por el nervio axilar',
  options: null,
};
const invented: AiNoteDraft = {
  ...supported,
  front: '¿Qué músculo abduce el brazo?',
  back: 'El supraespinoso',
  sourceQuote: 'El supraespinoso inicia la abducción',
};

const answer =
  (drafts: AiNoteDraft[], discarded = 0) =>
  () =>
    Promise.resolve({ drafts, discarded });

let deckId: string;
beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  deckId = (await createDeck({ name: 'Hombro' }, { now: T0 })).id;
  await db.outbox.clear();
});

describe('LD14-LD16: borradores de la IA', () => {
  it('guarda cada borrador para revisar, marcando los que no tienen su cita en el texto', async () => {
    const result = await requestAiDrafts(deckId, SOURCE, {
      now: T0,
      request: answer([supported, invented], 1),
    });
    expect(result).toEqual({ saved: 2, discarded: 1 });
    const rows = await db.aiDrafts.orderBy('id').toArray();
    expect(rows.map((r) => [r.draft.front, r.supported, r.status])).toEqual([
      [supported.front, true, 'draft'],
      [invented.front, false, 'draft'],
    ]);
    // Nada se vuelve nota sin que ella lo acepte (LD16).
    expect(await db.notes.count()).toBe(0);
    for (const entry of await db.outbox.toArray()) {
      expect(MutationSchema.parse(entry)).toMatchObject({ op: 'upsert', entity: 'aiDraft' });
    }
  });

  it('LD17: si la API falla no se guarda nada (su texto sigue en la pantalla)', async () => {
    const failing = () => Promise.reject(new ApiError(429, 'ai_quota_exceeded'));
    await expect(requestAiDrafts(deckId, SOURCE, { request: failing })).rejects.toThrow('ai_quota_exceeded');
    expect(await db.aiDrafts.count()).toBe(0);
  });

  it('aceptar crea la nota con origin ai y sus tarjetas, y la enlaza; un segundo toque no crea otra', async () => {
    await requestAiDrafts(deckId, SOURCE, { now: T0, request: answer([supported]) });
    const [row] = await db.aiDrafts.toArray();
    if (!row) throw new Error('sin borrador');
    const accepted = await acceptAiDraft(row.id, { now: T0 + 1 });
    const note = await db.notes.get(accepted.noteId ?? '');
    expect(note).toMatchObject({ deckId, origin: 'ai', content: { kind: 'basic', front: supported.front } });
    expect(await db.cards.get(cardIdFor(note?.id ?? '', 0))).toBeTruthy();
    expect(accepted).toMatchObject({ status: 'accepted' });
    await expect(acceptAiDraft(row.id, { now: T0 + 2 })).rejects.toThrow('ai_draft_not_acceptable');
    expect(await db.notes.count()).toBe(1);
  });

  it('LD16: sin respaldo no se acepta hasta que ella lo edita; editar sin cambios no cuenta', async () => {
    await requestAiDrafts(deckId, SOURCE, { now: T0, request: answer([invented]) });
    const [row] = await db.aiDrafts.toArray();
    if (!row) throw new Error('sin borrador');
    await expect(acceptAiDraft(row.id)).rejects.toThrow('ai_draft_not_acceptable');
    expect((await editAiDraft(row.id, row.draft)).edited).toBe(false);
    const fixed = await editAiDraft(row.id, { ...row.draft, back: 'El deltoides y el supraespinoso' });
    expect(fixed).toMatchObject({ edited: true, draft: { back: 'El deltoides y el supraespinoso' } });
    expect((await acceptAiDraft(row.id)).status).toBe('accepted');
  });

  it('un borrador que no forma una tarjeta válida no crea nada', async () => {
    const cloze: AiNoteDraft = { ...supported, kind: 'cloze', front: 'Sin huecos marcados' };
    await requestAiDrafts(deckId, SOURCE, { now: T0, request: answer([cloze]) });
    const [row] = await db.aiDrafts.toArray();
    if (!row) throw new Error('sin borrador');
    await expect(acceptAiDraft(row.id)).rejects.toThrow('ai_draft_invalid');
    expect(await db.notes.count()).toBe(0);
    expect((await db.aiDrafts.get(row.id))?.status).toBe('draft');
  });

  it('descartar lo deja como rejected, sin borrarlo', async () => {
    await requestAiDrafts(deckId, SOURCE, { now: T0, request: answer([supported]) });
    const [row] = await db.aiDrafts.toArray();
    if (!row) throw new Error('sin borrador');
    await rejectAiDraft(row.id, { now: T0 + 1 });
    expect(await db.aiDrafts.get(row.id)).toMatchObject({ status: 'rejected', deletedAt: null });
  });
});
