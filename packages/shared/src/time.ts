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

export const DAY_MS = 86_400_000;

// Día local de ella (AGENTS AG6): "vencidas hoy", ventanas de días (P3, P6, P7) y la hora de
// dormir dependen de su zona horaria, no de la del dispositivo ni la del servidor.

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: number, timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, format);
  }
  const wall = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const { type, value } of format.formatToParts(instant)) {
    if (type in wall) wall[type as keyof typeof wall] = Number(value); // salta los separadores
  }
  return wall;
}

/** Desfase de la zona respecto a UTC en ese instante (ms; positivo al este). */
function offsetMs(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(instant / 1000) * 1000;
}

/**
 * Número de día local (días desde 1970-01-01 en su calendario). La resta de dos números
 * es la distancia en días de calendario, con o sin horario de verano.
 */
export function localDayNumber(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day) / DAY_MS;
}

/** Inicio (inclusivo) y fin (exclusivo) del día local que contiene `instant`, en epoch ms. */
export function localDayBounds(instant: number, timeZone: string): { start: number; end: number } {
  const guess = offsetMs(instant, timeZone);
  const startOf = (day: number) => {
    const midnight = day * DAY_MS;
    // Se corrige el desfase en el instante hallado: a medianoche puede no ser el de
    // `instant` (horario de verano). Dos pasadas bastan porque los cambios son de horas.
    const first = midnight - offsetMs(midnight - guess, timeZone);
    return midnight - offsetMs(first, timeZone);
  };
  const day = localDayNumber(instant, timeZone);
  return { start: startOf(day), end: startOf(day + 1) };
}

/** Minuto del día local (0-1439), para comparar con horas `HH:mm` (R12, P6). */
export function localMinuteOfDay(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return w.hour * 60 + w.minute;
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
