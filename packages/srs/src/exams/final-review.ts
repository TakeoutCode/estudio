import { type Exam, localDayBounds, localDayNumber, type StudyConfig } from '@estudio/shared';
import type { Scheduler } from '../fsrs/scheduler.js';
import { isLeech, limitTopicRuns, type PlannerCard, type QueueItem } from '../planner/queue.js';

// Repaso previo al examen (LEARNING-DESIGN LD12; STUDY-METHODS R11): en los últimos días,
// una vuelta por lo que FSRS programó para después del examen. Se registran como repasos
// normales; FSRS los toma como anticipados y no se edita ninguna fecha (R18, §3).

/** Inicio del día local que está `days` días antes del día del examen. */
function windowStart(examDate: number, days: number, timeZone: string): number {
  let start = localDayBounds(examDate, timeZone).start;
  for (let d = 0; d < days; d += 1) start = localDayBounds(start - 1, timeZone).start;
  return start;
}

/**
 * LD12: tarjetas del alcance ya aprendidas cuyo `due` cae después del inicio del examen y
 * que no repasó desde que empezó la ventana (una sola vuelta). Fuera de la ventana de
 * `finalReviewWindowDays` días, vacía. Menor retrievability primero (§3) y mezcladas (P4).
 */
export function finalReviewQueue(
  exam: Pick<Exam, 'date' | 'topicIds'>,
  cards: readonly PlannerCard[],
  scheduler: Scheduler,
  now: number,
  timeZone: string,
  cfg: Pick<StudyConfig, 'planner' | 'exam'>,
): QueueItem[] {
  const until = localDayNumber(exam.date, timeZone) - localDayNumber(now, timeZone);
  if (until < 0 || until >= cfg.exam.finalReviewWindowDays) return [];
  const since = windowStart(exam.date, cfg.exam.finalReviewWindowDays, timeZone);
  const scope = new Set(exam.topicIds);
  const candidates = cards
    .filter(
      (c) =>
        c.topicId !== null &&
        scope.has(c.topicId) &&
        (c.state.phase === 'review' || c.state.phase === 'relearning') &&
        c.state.due >= exam.date &&
        (c.state.lastReview ?? 0) < since &&
        !isLeech(c, cfg.planner),
    )
    .map((c) => ({ card: c, r: scheduler.retrievability(c.state, now) }))
    .sort(
      (a, b) =>
        a.r - b.r ||
        a.card.state.due - b.card.state.due ||
        (a.card.state.cardId < b.card.state.cardId ? -1 : 1),
    );
  return limitTopicRuns(
    candidates.map(({ card }) => ({
      cardId: card.state.cardId,
      topicId: card.topicId,
      kind: 'review' as const,
    })),
    cfg.planner.reviewMaxSameTopicRun,
  );
}
