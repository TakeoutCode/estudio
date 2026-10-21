import type { ExerciseKind, NoteContent } from '@estudio/shared';

/** LD §2: los tipos de ejercicio que ya se pueden crear, en el orden del selector. */
export const EXERCISE_KINDS = [
  'true_false_justify',
  'open_question',
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
}

export const emptyExerciseDraft = (): ExerciseDraft => ({
  statement: '',
  isTrue: null,
  justification: '',
  question: '',
  key: '',
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
  }
}
