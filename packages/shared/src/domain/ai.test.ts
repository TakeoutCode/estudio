import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import {
  AI_INPUT_MAX_LENGTH,
  type AiDraft,
  aiDraftToNoteContent,
  AiDraftRequestSchema,
  AiDraftSchema,
  type AiNoteDraft,
  AiNoteDraftSchema,
  canAcceptAiDraft,
  isQuoteInSource,
} from './ai.js';

const basic = {
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: 'Sale del fascículo posterior.',
  sourceQuote: 'El deltoides está inervado por el nervio axilar',
  options: null,
} as const;

describe('LD15: borradores de nota de la IA', () => {
  it('valida la forma y los límites; sin campos de más', () => {
    expect(AiNoteDraftSchema.safeParse(basic).success).toBe(true);
    expect(AiNoteDraftSchema.safeParse({ ...basic, explanation: 'x'.repeat(401) }).success).toBe(false);
    expect(AiNoteDraftSchema.safeParse({ ...basic, sourceQuote: '' }).success).toBe(false);
    expect(AiNoteDraftSchema.safeParse({ ...basic, rating: 3 }).success).toBe(false); // LD14: no califica
    expect(AiDraftRequestSchema.safeParse({ sourceText: 'x'.repeat(AI_INPUT_MAX_LENGTH + 1) }).success).toBe(
      false,
    );
  });

  it('LD16: la cita tiene que estar literal en su texto (solo se ignoran espacios y mayúsculas)', () => {
    const source = 'Anatomía.\nEl deltoides  está inervado por el NERVIO axilar, rama del plexo.';
    expect(isQuoteInSource(source, basic.sourceQuote)).toBe(true);
    expect(isQuoteInSource(source, 'El deltoides está inervado por el nervio radial')).toBe(false);
    expect(isQuoteInSource(source, '   ')).toBe(false);
  });

  it('cada tipo se convierte en una nota válida, o en null si no lo es', () => {
    expect(aiDraftToNoteContent(basic)).toEqual({
      kind: 'basic',
      front: basic.front,
      back: basic.back,
      explanation: basic.explanation,
      reverse: false,
    });
    const cloze = {
      ...basic,
      kind: 'cloze',
      front: 'El deltoides lo inerva el {{c1::axilar}}.',
      back: 'axilar',
    } as const;
    expect(aiDraftToNoteContent(cloze)).toMatchObject({ kind: 'cloze', text: cloze.front });
    expect(aiDraftToNoteContent({ ...cloze, front: 'Sin huecos' })).toBeNull();
    const choice: AiNoteDraft = {
      ...basic,
      kind: 'multiple_choice',
      back: 'Axilar',
      options: ['Radial', 'axilar', 'Musculocutáneo'],
    };
    expect(aiDraftToNoteContent(choice)).toMatchObject({ kind: 'multiple_choice', correct: 1 });
    expect(aiDraftToNoteContent({ ...choice, back: 'Mediano' })).toBeNull();
    expect(aiDraftToNoteContent({ ...choice, options: null })).toBeNull();
  });

  it('LD16: el borrador es LWW y sin respaldo solo se acepta después de editarlo', () => {
    const row: AiDraft = {
      id: newId(),
      hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
      updatedAt: 1_760_000_000_000,
      deletedAt: null,
      kind: 'note',
      deckId: newId(),
      draft: basic,
      supported: false,
      edited: false,
      status: 'draft',
      noteId: null,
      createdAt: 1_760_000_000_000,
    };
    expect(SYNC_ROW_SCHEMAS.aiDraft).toBe(AiDraftSchema);
    expect(AiDraftSchema.safeParse(row).success).toBe(true);
    expect(AiDraftSchema.safeParse({ ...row, status: 'auto_accepted' }).success).toBe(false);
    expect(canAcceptAiDraft(row)).toBe(false);
    expect(canAcceptAiDraft({ ...row, edited: true })).toBe(true);
    expect(canAcceptAiDraft({ ...row, supported: true })).toBe(true);
    expect(canAcceptAiDraft({ ...row, supported: true, status: 'accepted' })).toBe(false);
  });
});
