import { type ExerciseKind, type NoteContent, SEQUENCE_ITEMS } from '@estudio/shared';

/** LD §2: los tipos de ejercicio que ya se pueden crear, en el orden del selector. */
export const EXERCISE_KINDS = [
  'true_false_justify',
  'open_question',
  'sequence',
] as const satisfies readonly ExerciseKind[];
export type EditableExerciseKind = (typeof EXERCISE_KINDS)[number];

export const isEditableExerciseKind = (kind: string): kind is EditableExerciseKind =>
  (EXERCISE_KINDS as readonly string[]).includes(kind);

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
}

export const emptyExerciseDraft = (): ExerciseDraft => ({
  statement: '',
  isTrue: null,
  justification: '',
  question: '',
  key: '',
  prompt: '',
  items: Array.from({ length: SEQUENCE_ITEMS.min }, () => ''),
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
    default:
      return draft;
  }
}

/** El contenido sin validar; el editor lo pasa por `NoteContentSchema`. */
export function exerciseContent(
  kind: EditableExerciseKind,
  draft: ExerciseDraft,
  explanation: string,
): unknown {
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
  }
}
