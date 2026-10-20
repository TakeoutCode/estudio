import {
  DAY_MS,
  type Exam,
  localDayNumber,
  localMinuteOfDay,
  type LocalTime,
  minutesOfDay,
  type NotificationPrefs,
  type ReviewLog,
  type StudyConfig,
} from '@estudio/shared';
import { examPlan } from '../exams/plan.js';
import type { Scheduler } from '../fsrs/scheduler.js';
import { buildSessionQueue, type PlannerCard } from '../planner/queue.js';

// Qué recordatorios califican en un tick del cron (NOTIFICATIONS §1 y NT3). La decisión de
// enviarlos (horas silenciosas, tope, reducción) es de `decideNotification`.

/** Cuántos temas se nombran en el texto (NT6: solo nombres de temas, nunca contenido). */
const TOPICS_IN_TEXT = 3;

export interface ReminderInput {
  readonly cards: readonly PlannerCard[];
  readonly logs: readonly ReviewLog[];
  readonly config: StudyConfig;
  readonly scheduler: Scheduler;
  readonly exams: readonly Pick<Exam, 'id' | 'date' | 'topicIds'>[];
  /** `examId:N` ya avisados: un aviso por examen y por cada N (NT-T11). */
  readonly notifiedExamDays: ReadonlySet<string>;
  readonly prefs: Pick<NotificationPrefs, 'examSoonDaysBefore'>;
  readonly now: number;
  readonly timeZone: string;
}

export interface ReminderCandidates {
  /** NT3: pendientes de hoy, contadas igual que en Hoy, y los temas que más pesan. */
  readonly dueToday: { readonly count: number; readonly topicIds: readonly string[] };
  readonly examSoon: readonly { readonly examId: string; readonly days: number }[];
  /** LD11: el plan sugiere nuevas para hoy y todavía no completó esa cuota (NT-T12). */
  readonly studyPlan: { readonly newToday: number; readonly topicIds: readonly string[] } | null;
}

/**
 * NT3: si su hora del recordatorio pasó en el tick `(from, to]`, en su zona. Compara minutos
 * locales, así que el cambio de horario no adelanta ni repite el aviso; un tick perdido no
 * se recupera tarde (un aviso aplazado llega sin que ella lo espere).
 */
export function reminderTimeCrossed(from: number, to: number, timeZone: string, time: LocalTime): boolean {
  if (to <= from) return false;
  if (to - from >= DAY_MS) return true;
  const target = minutesOfDay(time);
  const start = localMinuteOfDay(from, timeZone);
  const end = localMinuteOfDay(to, timeZone);
  if (localDayNumber(from, timeZone) === localDayNumber(to, timeZone)) return start < target && target <= end;
  return target > start || target <= end;
}

/** Tarjetas cuyo primer repaso fue hoy (día local): las nuevas que ya empezó hoy. */
export function newStartedToday(logs: readonly ReviewLog[], now: number, timeZone: string): number {
  const first = new Map<string, number>();
  for (const log of logs) {
    const at = first.get(log.cardId);
    if (at === undefined || log.reviewedAt < at) first.set(log.cardId, log.reviewedAt);
  }
  const today = localDayNumber(now, timeZone);
  return [...first.values()].filter((at) => localDayNumber(at, timeZone) === today).length;
}

const topTopics = (topicIds: readonly (string | null)[]): string[] => {
  const counts = new Map<string, number>();
  for (const id of topicIds) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOPICS_IN_TEXT)
    .map(([id]) => id);
};

export function reminderCandidates(input: ReminderInput): ReminderCandidates {
  const { now, timeZone, config } = input;
  const plan = buildSessionQueue({
    cards: input.cards,
    logs: input.logs,
    config,
    scheduler: input.scheduler,
    now,
    timeZone,
  });
  const plans = input.exams.map((exam) => ({
    exam,
    plan: examPlan(exam, input.cards, now, timeZone, config),
  }));
  const examSoon = plans
    .filter(
      ({ exam, plan: p }) =>
        !p.past &&
        input.prefs.examSoonDaysBefore.includes(p.daysLeft) &&
        !input.notifiedExamDays.has(`${exam.id}:${String(p.daysLeft)}`),
    )
    .map(({ exam, plan: p }) => ({ examId: exam.id, days: p.daysLeft }));
  const suggested = Math.max(
    0,
    ...plans.filter(({ plan: p }) => !p.past).map(({ plan: p }) => p.suggestedNewPerDay),
  );
  const newToday = newStartedToday(input.logs, now, timeZone);
  const studyTopics = plans.flatMap(({ plan: p }) =>
    p.topics.filter((t) => t.newRemaining > 0).map((t) => t.topicId),
  );
  return {
    dueToday: {
      count: plan.due,
      topicIds: topTopics(plan.queue.filter((q) => q.kind === 'review').map((q) => q.topicId)),
    },
    examSoon,
    studyPlan:
      suggested > newToday
        ? { newToday: suggested - newToday, topicIds: [...new Set(studyTopics)].slice(0, TOPICS_IN_TEXT) }
        : null,
  };
}
