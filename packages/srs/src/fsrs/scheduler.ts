import type { ExamConfig, FsrsConfig, Rating, ReviewLog } from '@estudio/shared';
import {
  type Card as FsrsCard,
  createEmptyCard,
  fsrs,
  GenSeedStrategyWithCardId,
  generatorParameters,
  type Grade,
  Rating as FsrsRating,
  State,
  StrategyMode,
} from 'ts-fsrs';

// El estado FSRS de una tarjeta es una proyección de su ReviewLog (ARCHITECTURE ARC5,
// ADR-003): cliente y servidor lo calculan con `replay()` y llegan al mismo resultado.

export type CardPhase = 'new' | 'learning' | 'review' | 'relearning';

/** Estado FSRS de una tarjeta. Fechas en epoch ms. */
export interface CardState {
  readonly cardId: string;
  readonly due: number;
  readonly stability: number;
  readonly difficulty: number;
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly reps: number;
  readonly lapses: number;
  readonly phase: CardPhase;
  readonly lastReview: number | null;
}

export interface ReviewInput {
  readonly reviewedAt: number;
  readonly rating: Rating;
}

export interface Scheduler {
  apply(state: CardState, review: ReviewInput): CardState;
}

const PHASE: Record<State, CardPhase> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};
const STATE: Record<CardPhase, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const GRADE: Record<Rating, Grade> = {
  1: FsrsRating.Again,
  2: FsrsRating.Hard,
  3: FsrsRating.Good,
  4: FsrsRating.Easy,
};

const fromFsrs = (cardId: string, card: FsrsCard): CardState => ({
  cardId,
  due: card.due.getTime(),
  stability: card.stability,
  difficulty: card.difficulty,
  scheduledDays: card.scheduled_days,
  learningSteps: card.learning_steps,
  reps: card.reps,
  lapses: card.lapses,
  phase: PHASE[card.state],
  lastReview: card.last_review?.getTime() ?? null,
});

const toFsrs = (s: CardState) => ({
  card_id: s.cardId, // lo usa la semilla del fuzz
  due: s.due,
  stability: s.stability,
  difficulty: s.difficulty,
  elapsed_days: 0, // obsoleto en ts-fsrs 5; lo recalcula desde last_review
  scheduled_days: s.scheduledDays,
  learning_steps: s.learningSteps,
  reps: s.reps,
  lapses: s.lapses,
  state: STATE[s.phase],
  last_review: s.lastReview,
});

/** Tarjeta sin repasos, vencida desde su creación. */
export function newCardState(cardId: string, createdAt: number): CardState {
  return fromFsrs(cardId, createEmptyCard(createdAt));
}

/**
 * Programador FSRS con la retención objetivo de R2. La semilla del fuzz sale del id de la
 * tarjeta y su número de repasos, sin decimales, así que el resultado no depende del motor
 * JS (iPhone, PC o servidor).
 */
export function createScheduler(cfg: FsrsConfig): Scheduler {
  const engine = fsrs(
    generatorParameters({
      request_retention: cfg.requestRetention,
      maximum_interval: cfg.maximumIntervalDays,
      enable_fuzz: cfg.enableFuzz,
    }),
  ).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId('card_id'));

  return {
    apply(state, review) {
      const { card } = engine.next(toFsrs(state), review.reviewedAt, GRADE[review.rating]);
      return fromFsrs(state.cardId, card);
    },
  };
}

/** P7 y ADR-009: los simulacros cuentan para FSRS solo si `exam.affectsScheduling`. */
export const countsForScheduling = (
  log: Pick<ReviewLog, 'type'>,
  exam: Pick<ExamConfig, 'affectsScheduling'>,
): boolean => log.type !== 'exam' || exam.affectsScheduling;

/** Orden canónico del log (SYNC §5): hora del repaso y, si empatan, id (UUIDv7). */
export const byReviewOrder = (
  a: Pick<ReviewLog, 'reviewedAt' | 'id'>,
  b: Pick<ReviewLog, 'reviewedAt' | 'id'>,
): number => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Reconstruye el estado de una tarjeta desde su log, en cualquier orden de llegada.
 * Ignora logs de otras tarjetas.
 */
export function replay(
  scheduler: Scheduler,
  initial: CardState,
  logs: readonly ReviewLog[],
  exam: Pick<ExamConfig, 'affectsScheduling'>,
): CardState {
  return logs
    .filter((log) => log.cardId === initial.cardId && countsForScheduling(log, exam))
    .sort(byReviewOrder)
    .reduce((state, log) => scheduler.apply(state, log), initial);
}
