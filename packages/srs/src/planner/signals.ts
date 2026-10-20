import {
  DAY_MS,
  type ExamConfig,
  isMinuteInRange,
  type LocalTime,
  localDayNumber,
  localMinuteOfDay,
  type MinuteRange,
  type PlannerConfig,
  type ReviewLog,
  type TimerBlockLog,
} from '@estudio/shared';
import { byReviewOrder } from '../fsrs/scheduler.js';
import { isRecalled, median } from './history.js';

// Sugerencias durante y entre sesiones (STUDY-METHODS P5-P7). Todas son sugerencias: nada
// aquí bloquea ni corta (P6 "nunca bloquear", R8).

/**
 * P5 (heurística sin validar): en las últimas `fatigueWindowCards` respuestas el acierto
 * cayó `fatigueAccuracyDropPts` puntos frente a las primeras de la sesión y la mediana de
 * tiempo subió `fatigueLatencyFactor` veces. Las dos ventanas no se solapan.
 */
export function fatigueDetected(sessionLogs: readonly ReviewLog[], cfg: PlannerConfig): boolean {
  const n = cfg.fatigueWindowCards;
  if (sessionLogs.length < 2 * n) return false;
  const ordered = [...sessionLogs].sort(byReviewOrder);
  const first = ordered.slice(0, n);
  const last = ordered.slice(-n);
  const accuracy = (logs: readonly ReviewLog[]) =>
    (logs.filter((l) => isRecalled(l.rating)).length / n) * 100;
  const latency = (logs: readonly ReviewLog[]) => median(logs.map((l) => l.durationMs)) ?? 0;
  return (
    accuracy(first) - accuracy(last) >= cfg.fatigueAccuracyDropPts &&
    latency(last) >= cfg.fatigueLatencyFactor * latency(first)
  );
}

export type StopReason = 'queue_done' | 'blocks_done' | 'bedtime' | 'fatigue';

export interface StopInput {
  /** `nextCard` devolvió `done`: cola y cuota de nuevas completas. */
  readonly queueDone: boolean;
  readonly blocks: readonly Pick<TimerBlockLog, 'kind' | 'outcome' | 'endedAt'>[];
  /** Avisos de fatiga (P5) seguidos en la sesión. */
  readonly fatigueWarningsInRow: number;
  readonly now: number;
  readonly timeZone: string;
  /** `profile.bedtime`; si es null se usa el inicio de las horas silenciosas (LD §6). */
  readonly bedtime: LocalTime | null;
  readonly quietHours: MinuteRange;
  readonly cfg: PlannerConfig;
}

/** P6: motivos para sugerir parar. Lista vacía = nada que sugerir. */
export function stopSuggestions(input: StopInput): StopReason[] {
  const { cfg, now, timeZone } = input;
  const today = localDayNumber(now, timeZone);
  const netBlocks = input.blocks.filter(
    (b) => b.kind === 'focus' && b.outcome === 'completed' && localDayNumber(b.endedAt, timeZone) === today,
  ).length;
  // "Pasó su hora de dormir": de esa hora hasta el fin de las horas silenciosas.
  const night = { start: input.bedtime ?? input.quietHours.start, end: input.quietHours.end };
  const reasons: StopReason[] = [];
  if (input.queueDone) reasons.push('queue_done');
  if (netBlocks >= cfg.stopAfterNetBlocks) reasons.push('blocks_done');
  if (isMinuteInRange(localMinuteOfDay(now, timeZone), night)) reasons.push('bedtime');
  if (input.fatigueWarningsInRow >= cfg.fatigueWarningsToStop) reasons.push('fatigue');
  return reasons;
}

export interface ExamDate {
  readonly examId: string;
  /** Inicio del examen, epoch ms. */
  readonly date: number;
}

export interface MockTaken {
  readonly examId: string;
  readonly takenAt: number;
}

export interface MockDue {
  readonly examId: string;
  /** Simulacros que faltan en los últimos 7 días. */
  readonly missing: number;
}

/**
 * P7: con un examen a menos de `mockWeeksBeforeExam` semanas, al menos `mocksPerWeek`
 * simulacros por semana (ventana móvil de 7 días). Exámenes pasados no cuentan.
 */
export function mocksDue(
  exams: readonly ExamDate[],
  mocks: readonly MockTaken[],
  now: number,
  cfg: Pick<ExamConfig, 'mockWeeksBeforeExam' | 'mocksPerWeek'>,
): MockDue[] {
  const week = 7 * DAY_MS;
  return exams
    .filter((exam) => exam.date > now && exam.date - now < cfg.mockWeeksBeforeExam * week)
    .map((exam) => {
      const taken = mocks.filter(
        (m) => m.examId === exam.examId && m.takenAt <= now && m.takenAt > now - week,
      ).length;
      return { examId: exam.examId, missing: Math.max(0, cfg.mocksPerWeek - taken) };
    })
    .filter((due) => due.missing > 0);
}
