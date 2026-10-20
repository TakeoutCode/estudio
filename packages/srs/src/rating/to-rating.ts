import { type Confidence, type ExamConfig, type ExerciseConfig, Rating } from '@estudio/shared';

// De la respuesta a la calificación FSRS (LEARNING-DESIGN LD2). Determinista: la misma
// respuesta da la misma calificación en cualquier dispositivo y al reproducir el log.

export type RatingInput =
  /** basic, cloze, image_occlusion, open_question: ella elige. */
  | { readonly kind: 'self'; readonly rating: Rating }
  /** type_answer, multiple_choice: el error es Again fijo; con acierto elige, Good por defecto. */
  | { readonly kind: 'objective'; readonly correct: boolean; readonly chosen?: Exclude<Rating, 1> }
  /** sequence, matching, label_image: puntaje en [0, 1]. */
  | { readonly kind: 'scored'; readonly score: number; readonly upgradeToEasy?: boolean }
  | {
      readonly kind: 'true_false_justify';
      readonly verdictCorrect: boolean;
      readonly justification: 'sufficient' | 'weak';
    }
  /** Simulacros (P7): la confianza se pide antes de revelar (R6). */
  | { readonly kind: 'exam'; readonly correct: boolean; readonly confidence: Confidence };

export interface RatingConfig {
  readonly exam: Pick<ExamConfig, 'highConfidenceMin'>;
  readonly exercise: ExerciseConfig;
}

export function toRating(input: RatingInput, cfg: RatingConfig): Rating {
  switch (input.kind) {
    case 'self':
      return input.rating;
    case 'objective':
      return input.correct ? (input.chosen ?? Rating.Good) : Rating.Again;
    case 'scored': {
      if (!(input.score >= 0 && input.score <= 1)) throw new RangeError('score_out_of_range');
      if (input.score >= cfg.exercise.goodMinScore) return input.upgradeToEasy ? Rating.Easy : Rating.Good;
      return input.score >= cfg.exercise.hardMinScore ? Rating.Hard : Rating.Again;
    }
    case 'true_false_justify':
      if (!input.verdictCorrect) return Rating.Again;
      return input.justification === 'sufficient' ? Rating.Good : Rating.Hard;
    case 'exam':
      if (!input.correct) return Rating.Again;
      return input.confidence >= cfg.exam.highConfidenceMin ? Rating.Good : Rating.Hard;
  }
}

/** Puntaje de una secuencia: `1 − inversiones / inversiones máximas` (Kendall, LD §2). */
export function sequenceScore(answer: readonly string[], expected: readonly string[]): number {
  if (answer.length !== expected.length || new Set(answer).size !== answer.length) {
    throw new RangeError('sequence_mismatch');
  }
  const position = new Map(expected.map((item, index) => [item, index]));
  const ranks = answer.map((item) => {
    const rank = position.get(item);
    if (rank === undefined) throw new RangeError('sequence_mismatch');
    return rank;
  });
  if (ranks.length < 2) return 1;
  let inversions = 0;
  for (let i = 0; i < ranks.length; i += 1) {
    for (let j = i + 1; j < ranks.length; j += 1) {
      if ((ranks[i] ?? 0) > (ranks[j] ?? 0)) inversions += 1;
    }
  }
  return 1 - inversions / ((ranks.length * (ranks.length - 1)) / 2);
}

/** Puntaje de relacionar columnas o etiquetar imagen: aciertos / total. */
export function fractionScore(correct: number, total: number): number {
  if (
    !Number.isInteger(correct) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    correct < 0 ||
    correct > total
  ) {
    throw new RangeError('fraction_out_of_range');
  }
  return correct / total;
}
