import { localDayBounds } from '@estudio/shared';

// Ventanas de 7 días locales (AGENTS AG6) para las métricas semanales de §5.

const WEEK_DAYS = 7;

export interface TimeWindow {
  /** Inicio inclusivo y fin exclusivo, epoch ms. */
  readonly start: number;
  readonly end: number;
}

/** Las `count` ventanas de 7 días locales más recientes; la primera termina al acabar hoy (AG6). */
export function weekWindows(now: number, timeZone: string, count: number): TimeWindow[] {
  const windows: TimeWindow[] = [];
  let end = localDayBounds(now, timeZone).end;
  for (let w = 0; w < count; w += 1) {
    let start = end;
    for (let d = 0; d < WEEK_DAYS; d += 1) start = localDayBounds(start - 1, timeZone).start;
    windows.push({ start, end });
    end = start;
  }
  return windows;
}
