import {
  defaultStudyConfig,
  type PlannerConfig,
  Rating,
  type ReviewLog,
  type StudyConfig,
} from '@estudio/shared';
import { type CardState, createScheduler, newCardState } from '../fsrs/scheduler.js';
import type { PlannerCard, SessionPlanInput } from '../planner/queue.js';

// Escenarios del planificador. Ella vive en CDMX (UTC−6); NOW es martes 20 a las 09:00.

export const TZ = 'America/Mexico_City';
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const NOW = Date.UTC(2026, 9, 20, 15);
/** Medianoche local de hoy. */
export const TODAY_START = Date.UTC(2026, 9, 20, 6);

const SESSION = '0192f1a0-0000-7000-8000-00000000a001';
const DEVICE = '0192f1a0-0000-7000-8000-00000000d001';

export const id = (n: number, prefix = 'c') =>
  `0192f1a0-0000-7000-8${prefix === 'c' ? '000' : '111'}-${n.toString().padStart(12, '0')}`;

export const cfgWith = (
  planner: Partial<PlannerConfig> = {},
  rest: Partial<StudyConfig> = {},
): StudyConfig => {
  const base = defaultStudyConfig();
  return { ...base, ...rest, planner: { ...base.planner, ...planner } };
};

/** Tarjeta aprendida que vence en `due`; menos estabilidad = menor retrievability. */
export function reviewCard(
  n: number,
  opts: {
    due?: number;
    topic?: string | null;
    stability?: number;
    lapses?: number;
    lapseBaseline?: number;
  } = {},
): PlannerCard {
  const due = opts.due ?? NOW - HOUR;
  const stability = opts.stability ?? 10;
  const state: CardState = {
    cardId: id(n),
    due,
    stability,
    difficulty: 5,
    scheduledDays: Math.round(stability),
    learningSteps: 0,
    reps: 4,
    lapses: opts.lapses ?? 0,
    phase: 'review',
    lastReview: due - stability * DAY,
  };
  return { state, topicId: opts.topic ?? 'anatomia', lapseBaseline: opts.lapseBaseline ?? 0 };
}

export const newCard = (n: number, topic: string | null = 'anatomia'): PlannerCard => ({
  state: newCardState(id(n), NOW - 30 * DAY + n),
  topicId: topic,
  lapseBaseline: 0,
});

export const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

let logSeq = 0;
export function log(
  reviewedAt: number,
  rating: Rating,
  opts: { type?: ReviewLog['type']; durationMs?: number; cardId?: string } = {},
): ReviewLog {
  logSeq += 1;
  return {
    id: id(logSeq, 'l'),
    cardId: opts.cardId ?? id(900_000 + logSeq),
    cardKind: 'basic',
    reviewedAt,
    rating,
    durationMs: opts.durationMs ?? 15_000,
    type: opts.type ?? 'review',
    confidence: null,
    sessionId: SESSION,
    deviceId: DEVICE,
  };
}

/** `count` repasos el día local que empieza en `dayStart`, `recalled` de ellos con Good. */
export const dayOfReviews = (dayStart: number, count: number, recalled: number): ReviewLog[] =>
  range(0, count).map((i) =>
    log(dayStart + 2 * HOUR + i * 60_000, i < recalled ? Rating.Good : Rating.Again),
  );

export function input(
  patch: Partial<SessionPlanInput> & { cards: readonly PlannerCard[] },
): SessionPlanInput {
  const config = patch.config ?? defaultStudyConfig();
  return {
    logs: [],
    config,
    scheduler: createScheduler(config.fsrs),
    now: NOW,
    timeZone: TZ,
    ...patch,
  };
}
