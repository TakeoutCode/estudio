import { z } from 'zod';

/** Hora local `HH:mm` (24 h). */
export const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid_local_time');
export type LocalTime = z.infer<typeof LocalTimeSchema>;

export interface MinuteRange {
  readonly start: LocalTime;
  readonly end: LocalTime;
}

export const MINUTES_PER_DAY = 24 * 60;

/** Minutos desde la medianoche para `HH:mm`. */
export function minutesOfDay(time: LocalTime): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * ¿El minuto del día cae en el rango? `start` es inclusivo y `end` exclusivo; si
 * `start > end` el rango cruza la medianoche (22:00-07:00, R12). Un rango vacío
 * (`start === end`) no contiene ningún minuto.
 */
export function isMinuteInRange(minute: number, range: MinuteRange): boolean {
  const start = minutesOfDay(range.start);
  const end = minutesOfDay(range.end);
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
