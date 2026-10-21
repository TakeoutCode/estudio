import { type ExerciseKind, MATCHING_PAIRS, type NoteContent, SEQUENCE_ITEMS } from '@estudio/shared';

/** LD §2: los tipos de ejercicio que ya se pueden crear, en el orden del selector. */
export const EXERCISE_KINDS = [
  'true_false_justify',
  'open_question',
  'sequence',
  'matching',
  'label_image',
  'clinical_case',
] as const satisfies readonly ExerciseKind[];
export type EditableExerciseKind = (typeof EXERCISE_KINDS)[number];

/** Las que se escriben con `ExerciseFields`; etiquetar una imagen usa el editor de oclusión (FE8). */
export type DraftExerciseKind = Exclude<EditableExerciseKind, 'label_image'>;

export const isDraftExerciseKind = (kind: string): kind is DraftExerciseKind =>
  kind !== 'label_image' && isEditableExerciseKind(kind);

export const isEditableExerciseKind = (kind: string): kind is EditableExerciseKind =>
  (EXERCISE_KINDS as readonly string[]).includes(kind);

/** Una subpregunta del caso clínico; `n` es su número estable (el ordinal de su Card). */
export interface ClinicalQuestionDraft {
  readonly n: number;
  readonly type: 'multiple_choice' | 'type_answer' | 'open';
  readonly question: string;
  readonly options: readonly string[];
  readonly correct: number | null;
  readonly answer: string;
  readonly key: string;
}

export const emptyClinicalQuestion = (n: number): ClinicalQuestionDraft => ({
  n,
  type: 'multiple_choice',
  question: '',
  options: ['', '', ''],
  correct: null,
  answer: '',
  key: '',
});

export interface MatchingPairDraft {
  readonly left: string;
  readonly right: string;
}

/** Lo que ella escribe en el editor de un ejercicio, antes de validarlo con su esquema (AG2). */
export interface ExerciseDraft {
  readonly statement: string;
  /** V/F: `null` hasta que elige. */
  readonly isTrue: boolean | null;
  readonly justification: string;
  readonly question: string;
  readonly key: string;
  /** La consigna de ordenar (y luego relacionar o etiquetar). */
  readonly prompt: string;
  /** Secuencia: en el orden correcto; las filas vacías no cuentan. */
  readonly items: readonly string[];
  /** Relacionar: cada fila es un par; las filas vacías no cuentan. */
  readonly pairs: readonly MatchingPairDraft[];
  /** Caso clínico: la viñeta y sus subpreguntas. */
  readonly vignette: string;
  readonly questions: readonly ClinicalQuestionDraft[];
}

export const emptyExerciseDraft = (): ExerciseDraft => ({
  statement: '',
  isTrue: null,
  justification: '',
  question: '',
  key: '',
  prompt: '',
  items: Array.from({ length: SEQUENCE_ITEMS.min }, () => ''),
  pairs: Array.from({ length: MATCHING_PAIRS.min }, () => ({ left: '', right: '' })),
  vignette: '',
  questions: [emptyClinicalQuestion(1)],
});

/** El borrador de un ejercicio guardado, para editarlo. */
export function exerciseDraftOf(content: NoteContent | undefined): ExerciseDraft {
  const draft = emptyExerciseDraft();
  switch (content?.kind) {
    case 'true_false_justify':
      return {
        ...draft,
        statement: content.statement,
        isTrue: content.isTrue,
        justification: content.justification,
      };
    case 'open_question':
      return { ...draft, question: content.question, key: content.key };
    case 'sequence':
      return { ...draft, prompt: content.prompt, items: [...content.items] };
    case 'matching':
      return { ...draft, prompt: content.prompt, pairs: content.pairs.map((p) => ({ ...p })) };
    case 'clinical_case':
      return {
        ...draft,
        vignette: content.vignette,
        questions: [...content.questions]
          .sort((a, b) => a.n - b.n)
          .map((q) => ({
            ...emptyClinicalQuestion(q.n),
            type: q.type,
            question: q.question,
            ...(q.type === 'multiple_choice'
              ? { options: [...q.options], correct: q.correct }
              : q.type === 'type_answer'
                ? { answer: q.answer }
                : { key: q.key }),
          })),
      };
    default:
      return draft;
  }
}

/** El contenido sin validar; el editor lo pasa por `NoteContentSchema`. */
export function exerciseContent(kind: DraftExerciseKind, draft: ExerciseDraft, explanation: string): unknown {
  switch (kind) {
    case 'true_false_justify':
      return {
        kind,
        statement: draft.statement,
        isTrue: draft.isTrue,
        justification: draft.justification,
        explanation,
      };
    case 'open_question':
      return { kind, question: draft.question, key: draft.key, explanation };
    case 'sequence':
      return {
        kind,
        prompt: draft.prompt,
        items: draft.items.map((item) => item.trim()).filter((item) => item !== ''),
        explanation,
      };
    case 'matching':
      return {
        kind,
        prompt: draft.prompt,
        // Una fila con un solo lado queda: el esquema la rechaza y el editor lo dice.
        pairs: draft.pairs
          .map((p) => ({ left: p.left.trim(), right: p.right.trim() }))
          .filter((p) => p.left !== '' || p.right !== ''),
        explanation,
      };
    case 'clinical_case':
      return {
        kind,
        vignette: draft.vignette,
        questions: draft.questions.map(clinicalQuestionContent),
        explanation,
      };
  }
}

/** Una subpregunta con solo los campos de su tipo; en opción múltiple las vacías no cuentan. */
function clinicalQuestionContent(q: ClinicalQuestionDraft): unknown {
  const base = { n: q.n, question: q.question };
  switch (q.type) {
    case 'multiple_choice': {
      const kept = q.options.map((text, i) => ({ text: text.trim(), i })).filter((o) => o.text !== '');
      return {
        ...base,
        type: q.type,
        options: kept.map((o) => o.text),
        correct: kept.findIndex((o) => o.i === q.correct),
      };
    }
    case 'type_answer':
      return { ...base, type: q.type, answer: q.answer };
    case 'open':
      return { ...base, type: q.type, key: q.key };
  }
}
