import { type AiClinicalCaseDraft, type AiNoteDraft, cardIdFor, MutationSchema } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createDeck } from '@/features/decks';
import { ApiError } from '@/lib/api';
import {
  acceptAiDraft,
  editAiDraft,
  markAiDistractorsUsed,
  rejectAiDraft,
  requestAiDistractors,
  requestAiDrafts,
} from './commands';

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
const clinicalCase: AiClinicalCaseDraft = {
  vignette: 'Paciente de 34 años con debilidad para abducir el brazo tras una luxación anterior del hombro.',
  questions: [
    {
      type: 'multiple_choice',
      question: '¿Qué nervio se lesionó?',
      answer: 'Axilar',
      options: ['Radial', 'Axilar', 'Mediano'],
    },
    { type: 'open', question: '¿Qué explorarías?', answer: 'La fuerza del deltoides', options: null },
  ],
  explanation: 'El axilar inerva el deltoides.',
  sourceQuote: 'El deltoides está inervado por el nervio axilar',
};

const answer =
  (drafts: AiNoteDraft[], discarded = 0) =>
  () =>
    Promise.resolve({ kind: 'note' as const, drafts, discarded });
const cases =
  (drafts: AiClinicalCaseDraft[], discarded = 0) =>
  () =>
    Promise.resolve({ kind: 'clinical_case' as const, drafts, discarded });

const only = async () => {
  const [row] = await db.aiDrafts.toArray();
  if (!row) throw new Error('sin borrador');
  return row;
};

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
    expect(
      rows.map((r) => [r.kind, r.kind === 'note' ? r.draft.front : null, r.supported, r.status]),
    ).toEqual([
      ['note', supported.front, true, 'draft'],
      ['note', invented.front, false, 'draft'],
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
    const row = await only();
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
    const row = await only();
    if (row.kind !== 'note') throw new Error('tipo');
    await expect(acceptAiDraft(row.id)).rejects.toThrow('ai_draft_not_acceptable');
    expect((await editAiDraft(row.id, row.draft)).edited).toBe(false);
    const fixed = await editAiDraft(row.id, { ...row.draft, back: 'El deltoides y el supraespinoso' });
    expect(fixed).toMatchObject({ edited: true, draft: { back: 'El deltoides y el supraespinoso' } });
    expect((await acceptAiDraft(row.id)).status).toBe('accepted');
  });

  it('un borrador que no forma una tarjeta válida no crea nada', async () => {
    const cloze: AiNoteDraft = { ...supported, kind: 'cloze', front: 'Sin huecos marcados' };
    await requestAiDrafts(deckId, SOURCE, { now: T0, request: answer([cloze]) });
    const row = await only();
    await expect(acceptAiDraft(row.id)).rejects.toThrow('ai_draft_invalid');
    expect(await db.notes.count()).toBe(0);
    expect((await db.aiDrafts.get(row.id))?.status).toBe('draft');
  });

  it('descartar lo deja como rejected, sin borrarlo', async () => {
    await requestAiDrafts(deckId, SOURCE, { now: T0, request: answer([supported]) });
    const row = await only();
    await rejectAiDraft(row.id, { now: T0 + 1 });
    expect(await db.aiDrafts.get(row.id)).toMatchObject({ status: 'rejected', deletedAt: null });
  });
});

describe('LD14-LD16: borradores de casos clínicos', () => {
  it('se guardan como AiDraft de caso, con su cita comprobada contra su texto', async () => {
    let asked: string | null = null;
    const request = (kind: 'note' | 'clinical_case', text: string) => {
      asked = `${kind}:${text}`;
      return cases([clinicalCase, { ...clinicalCase, sourceQuote: 'Inventado' }], 2)();
    };
    const result = await requestAiDrafts(deckId, SOURCE, { now: T0, kind: 'clinical_case', request });
    expect(asked).toBe(`clinical_case:${SOURCE}`);
    expect(result).toEqual({ saved: 2, discarded: 2 });
    const rows = await db.aiDrafts.orderBy('id').toArray();
    expect(rows.map((r) => [r.kind, r.supported])).toEqual([
      ['clinical_case', true],
      ['clinical_case', false],
    ]);
    expect(await db.notes.count()).toBe(0);
  });

  it('aceptar crea el caso clínico con origin ai y una Card por subpregunta', async () => {
    await requestAiDrafts(deckId, SOURCE, { now: T0, kind: 'clinical_case', request: cases([clinicalCase]) });
    const accepted = await acceptAiDraft((await only()).id, { now: T0 + 1 });
    const note = await db.notes.get(accepted.noteId ?? '');
    expect(note).toMatchObject({
      origin: 'ai',
      content: {
        kind: 'clinical_case',
        vignette: clinicalCase.vignette,
        questions: [
          { n: 1, correct: 1 },
          { n: 2, key: 'La fuerza del deltoides' },
        ],
      },
    });
    expect(await db.cards.get(cardIdFor(note?.id ?? '', 1))).toBeTruthy();
    expect(await db.cards.get(cardIdFor(note?.id ?? '', 2))).toBeTruthy();
  });

  it('LD16: editarlo lo valida con el esquema del caso y permite aceptarlo sin respaldo', async () => {
    await requestAiDrafts(deckId, SOURCE, {
      now: T0,
      kind: 'clinical_case',
      request: cases([{ ...clinicalCase, sourceQuote: 'Inventado' }]),
    });
    const row = await only();
    if (row.kind !== 'clinical_case') throw new Error('tipo');
    await expect(editAiDraft(row.id, { ...row.draft, questions: [] })).rejects.toThrow();
    const [, open] = row.draft.questions;
    if (!open) throw new Error('fixture');
    expect((await editAiDraft(row.id, { ...row.draft, questions: [open] })).edited).toBe(true);
    const accepted = await acceptAiDraft(row.id);
    expect((await db.notes.get(accepted.noteId ?? ''))?.content).toMatchObject({
      questions: [{ n: 1, type: 'open' }],
    });
  });

  it('uno que no forma un caso válido no crea nada', async () => {
    const [choice] = clinicalCase.questions;
    if (!choice) throw new Error('fixture');
    const broken = { ...clinicalCase, questions: [{ ...choice, answer: 'Cubital' }] };
    await requestAiDrafts(deckId, SOURCE, { now: T0, kind: 'clinical_case', request: cases([broken]) });
    await expect(acceptAiDraft((await only()).id)).rejects.toThrow('ai_draft_invalid');
    expect(await db.notes.count()).toBe(0);
  });
});

describe('LD14, LD16: distractores', () => {
  const request = {
    question: '¿Qué nervio inerva el deltoides?',
    correct: 'Axilar',
    existing: [],
    context: null,
  };

  it('se guardan como AiDraft sin nota; no se aceptan desde la pantalla de borradores', async () => {
    const draft = await requestAiDistractors(deckId, request, {
      now: T0,
      ask: () => Promise.resolve({ distractors: ['Radial', 'Mediano'] }),
    });
    expect(draft).toMatchObject({
      kind: 'distractors',
      deckId,
      status: 'draft',
      noteId: null,
      draft: { question: request.question, correct: 'Axilar', distractors: ['Radial', 'Mediano'] },
    });
    expect((await db.outbox.toArray()).map((e) => e.entity)).toEqual(['aiDraft']);
    await expect(acceptAiDraft(draft.id)).rejects.toThrow('ai_draft_not_acceptable');
    await expect(editAiDraft(draft.id, supported)).rejects.toThrow('ai_draft_closed');
  });

  it('usar alguno lo deja accepted; descartar sin usar, rejected', async () => {
    const ask = () => Promise.resolve({ distractors: ['Radial'] });
    const used = await requestAiDistractors(deckId, request, { now: T0, ask });
    await markAiDistractorsUsed(used.id, { now: T0 + 1 });
    await markAiDistractorsUsed(used.id, { now: T0 + 2 }); // un segundo uso no escribe otra vez
    expect(await db.aiDrafts.get(used.id)).toMatchObject({ status: 'accepted', noteId: null });
    const dropped = await requestAiDistractors(deckId, request, { now: T0, ask });
    await rejectAiDraft(dropped.id, { now: T0 + 1 });
    expect(await db.aiDrafts.get(dropped.id)).toMatchObject({ status: 'rejected' });
    expect(await db.notes.count()).toBe(0);
  });

  it('LD17: si la API falla no se guarda nada', async () => {
    const failing = () => Promise.reject(new ApiError(503, 'unavailable'));
    await expect(requestAiDistractors(deckId, request, { ask: failing })).rejects.toThrow('unavailable');
    expect(await db.aiDrafts.count()).toBe(0);
  });
});
