import { type MetricsConfig, type SleepLog, startOfLocalDate } from '@estudio/shared';
import { type TimeWindow, weekWindows } from './windows.js';

// Sueño (STUDY-METHODS §5): opcional y solo como contexto. Sin metas, sin rachas y sin
// relacionarlo con sus notas: las asociaciones de [30] son transversales y no prueban causa.

export interface SleepWeek {
  /** Noches anotadas. */
  readonly nights: number;
  /** Mediana de la calidad (1-5); null sin noches. */
  readonly median: number | null;
}

export interface SleepSummary {
  readonly week: SleepWeek;
  /** UX9: con menos de `sleepMinNights` noches en la semana, "Pocos datos todavía". */
  readonly enoughData: boolean;
  /** Sus semanas previas (hasta `baselineWeeks`), juntas; null si no llegan a `sleepMinNights`. */
  readonly baseline: SleepWeek | null;
}

type SleepConfig = Pick<MetricsConfig, 'baselineWeeks' | 'sleepMinNights'>;

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return null;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const summarize = (nights: readonly Pick<SleepLog, 'quality'>[]): SleepWeek => ({
  nights: nights.length,
  median: median(nights.map((n) => n.quality)),
});

/**
 * §5: la semana que termina hoy contra sus semanas previas. Cada noche cuenta en la semana del
 * día local en que la anotó (`date`, AG6). Las borradas no deben llegar aquí.
 */
export function sleepSummary(
  logs: readonly Pick<SleepLog, 'date' | 'quality'>[],
  cfg: SleepConfig,
  now: number,
  timeZone: string,
): SleepSummary {
  const [week, ...previous] = weekWindows(now, timeZone, 1 + cfg.baselineWeeks);
  if (!week) throw new RangeError('no_week');
  const dated = logs.map((log) => ({ ...log, at: startOfLocalDate(log.date, timeZone) }));
  const inside = (w: TimeWindow) => dated.filter((log) => log.at >= w.start && log.at < w.end);
  const current = summarize(inside(week));
  const before = summarize(previous.flatMap(inside));
  return {
    week: current,
    enoughData: current.nights >= cfg.sleepMinNights,
    baseline: before.nights >= cfg.sleepMinNights ? before : null,
  };
}
