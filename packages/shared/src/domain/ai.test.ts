import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { ENTITY_STRATEGY } from '../sync/entities.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import {
  AI_INPUT_MAX_LENGTH,
  type AiClinicalCaseDraft,
  AiClinicalCaseDraftSchema,
  aiClinicalCaseToNoteContent,
  AiDistractorsRequestSchema,
  AiDistractorsResponseSchema,
  type AiDraft,
  aiDraftToNoteContent,
  AiDraftRequestSchema,
  AiDraftSchema,
  AiFeedbackRequestSchema,
  AiFeedbackSchema,
  type AiNoteDraft,
  AiNoteDraftSchema,
  AiOpenFeedbackSchema,
  canAcceptAiDraft,
  isQuoteInSource,
  usableDistractors,
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

const clinicalCase: AiClinicalCaseDraft = {
  vignette: 'Paciente de 34 años con dolor en el hombro al abducir el brazo tras una luxación anterior.',
  questions: [
    {
      type: 'multiple_choice',
      question: '¿Qué nervio es el más expuesto?',
      answer: 'Axilar',
      options: ['Radial', 'axilar', 'Mediano'],
    },
    { type: 'type_answer', question: '¿Qué músculo pierde fuerza?', answer: 'Deltoides', options: null },
    {
      type: 'open',
      question: '¿Qué explorarías?',
      answer: 'La sensibilidad de la cara lateral del hombro',
      options: null,
    },
  ],
  explanation: 'El axilar rodea el cuello quirúrgico del húmero.',
  sourceQuote: 'El nervio axilar rodea el cuello quirúrgico del húmero',
};

describe('LD14, LD15: borradores de casos clínicos', () => {
  it('valida la forma y los límites de LD §2; sin calificación', () => {
    expect(AiClinicalCaseDraftSchema.safeParse(clinicalCase).success).toBe(true);
    expect(AiClinicalCaseDraftSchema.safeParse({ ...clinicalCase, questions: [] }).success).toBe(false);
    expect(
      AiClinicalCaseDraftSchema.safeParse({
        ...clinicalCase,
        questions: Array(7).fill(clinicalCase.questions[1]),
      }).success,
    ).toBe(false);
    expect(AiClinicalCaseDraftSchema.safeParse({ ...clinicalCase, rating: 3 }).success).toBe(false);
  });

  it('se convierte en un caso con subpreguntas numeradas desde 1', () => {
    expect(aiClinicalCaseToNoteContent(clinicalCase)).toEqual({
      kind: 'clinical_case',
      vignette: clinicalCase.vignette,
      questions: [
        {
          n: 1,
          type: 'multiple_choice',
          question: '¿Qué nervio es el más expuesto?',
          options: ['Radial', 'axilar', 'Mediano'],
          correct: 1,
        },
        { n: 2, type: 'type_answer', question: '¿Qué músculo pierde fuerza?', answer: 'Deltoides' },
        {
          n: 3,
          type: 'open',
          question: '¿Qué explorarías?',
          key: 'La sensibilidad de la cara lateral del hombro',
        },
      ],
      explanation: clinicalCase.explanation,
    });
  });

  it('null si no forma un caso válido', () => {
    const [choice, short] = clinicalCase.questions;
    if (!choice || !short) throw new Error('fixture');
    expect(
      aiClinicalCaseToNoteContent({ ...clinicalCase, questions: [{ ...choice, answer: 'Cubital' }] }),
    ).toBeNull();
    expect(
      aiClinicalCaseToNoteContent({ ...clinicalCase, questions: [{ ...choice, options: null }] }),
    ).toBeNull();
    expect(
      aiClinicalCaseToNoteContent({ ...clinicalCase, questions: [{ ...short, answer: 'x'.repeat(201) }] }),
    ).toBeNull();
  });

  it('LD16: es un AiDraft más, con su cita', () => {
    const row = {
      id: newId(),
      hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
      updatedAt: 1_760_000_000_000,
      deletedAt: null,
      kind: 'clinical_case',
      deckId: newId(),
      draft: clinicalCase,
      supported: true,
      edited: false,
      status: 'draft',
      noteId: null,
      createdAt: 1_760_000_000_000,
    };
    expect(AiDraftSchema.safeParse(row).success).toBe(true);
    expect(AiDraftSchema.safeParse({ ...row, draft: basic }).success).toBe(false);
    expect(AiDraftSchema.safeParse({ ...row, kind: 'note' }).success).toBe(false);
  });
});

describe('LD14: distractores de opción múltiple', () => {
  const request = {
    question: '¿Qué nervio inerva el deltoides?',
    correct: 'Axilar',
    existing: ['Radial'],
    context: null,
  };

  it('el pedido lleva la pregunta y la correcta; la respuesta, de 1 a 4 distractores', () => {
    expect(AiDistractorsRequestSchema.safeParse(request).success).toBe(true);
    expect(AiDistractorsRequestSchema.safeParse({ ...request, correct: ' ' }).success).toBe(false);
    expect(AiDistractorsRequestSchema.safeParse({ ...request, existing: Array(5).fill('x') }).success).toBe(
      false,
    );
    expect(AiDistractorsResponseSchema.safeParse({ distractors: [] }).success).toBe(false);
    expect(AiDistractorsResponseSchema.safeParse({ distractors: ['Mediano'] }).success).toBe(true);
  });

  it('sin repetir la correcta, lo que ya escribió ni entre sí (sin importar mayúsculas)', () => {
    expect(
      usableDistractors(
        ['axilar', ' RADIAL ', 'Mediano', 'mediano', '', 'Musculocutáneo', 'Cubital', 'Torácico largo'],
        request,
      ),
    ).toEqual(['Mediano', 'Musculocutáneo', 'Cubital', 'Torácico largo']);
  });

  it('LD16: queda como borrador sin nota; ella elige cuáles usa', () => {
    const row = {
      id: newId(),
      hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
      updatedAt: 1_760_000_000_000,
      deletedAt: null,
      kind: 'distractors',
      deckId: newId(),
      draft: { question: request.question, correct: request.correct, distractors: ['Mediano', 'Cubital'] },
      supported: true,
      edited: false,
      status: 'accepted',
      noteId: null,
      createdAt: 1_760_000_000_000,
    };
    expect(AiDraftSchema.safeParse(row).success).toBe(true);
    expect(AiDraftSchema.safeParse({ ...row, draft: { ...row.draft, distractors: [] } }).success).toBe(false);
  });
});

describe('LD15: retroalimentación de respuestas abiertas', () => {
  const feedback = {
    covered: ['Nombra el nervio axilar'],
    missing: ['Falta de qué fascículo sale'],
    misconceptions: [],
    suggestion: 'Agrega el origen en el plexo braquial.',
  };

  it('sin nota numérica ni campos de más: la calificación es de ella (LD14)', () => {
    expect(AiOpenFeedbackSchema.safeParse(feedback).success).toBe(true);
    expect(AiOpenFeedbackSchema.safeParse({ ...feedback, score: 0.8 }).success).toBe(false);
    expect(AiOpenFeedbackSchema.safeParse({ ...feedback, rating: 3 }).success).toBe(false);
    expect(AiOpenFeedbackSchema.safeParse({ ...feedback, covered: Array(9).fill('x') }).success).toBe(false);
  });

  it('el pedido lleva pregunta, clave y respuesta; se guarda como solo inserción', () => {
    expect(AiFeedbackRequestSchema.safeParse({ question: 'q', key: 'k', answer: 'a' }).success).toBe(true);
    expect(AiFeedbackRequestSchema.safeParse({ question: 'q', key: 'k', answer: '  ' }).success).toBe(false);
    expect(ENTITY_STRATEGY.aiFeedback).toBe('append');
    expect(SYNC_ROW_SCHEMAS.aiFeedback).toBe(AiFeedbackSchema);
    expect(
      AiFeedbackSchema.safeParse({ id: newId(), cardId: newId(), requestedAt: 1, feedback }).success,
    ).toBe(true);
  });
});
