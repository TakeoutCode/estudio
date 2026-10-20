import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  localDateOf,
  LocalDateSchema,
  localDayBounds,
  localDayNumber,
  localMinuteOfDay,
  startOfLocalDate,
} from './time.js';

const MX = 'America/Mexico_City'; // UTC−6 sin horario de verano desde 2022
const NY = 'America/New_York'; // cambia de horario el 2026-11-01 a las 02:00

describe('día local (AG6)', () => {
  it('el día cambia a la medianoche de ella, no a la de UTC', () => {
    const lateNight = Date.UTC(2026, 9, 21, 5, 30); // 23:30 del 20 en CDMX
    expect(localDayNumber(lateNight, MX)).toBe(localDayNumber(Date.UTC(2026, 9, 20, 12), MX));
    expect(localDayNumber(lateNight, 'UTC')).toBe(localDayNumber(Date.UTC(2026, 9, 20, 12), 'UTC') + 1);
    expect(localMinuteOfDay(lateNight, MX)).toBe(23 * 60 + 30);
  });

  it('límites del día en CDMX', () => {
    const { start, end } = localDayBounds(Date.UTC(2026, 9, 20, 15), MX);
    expect(start).toBe(Date.UTC(2026, 9, 20, 6));
    expect(end).toBe(Date.UTC(2026, 9, 21, 6));
  });

  it('el día del cambio de horario dura 25 h y los números de día siguen siendo consecutivos', () => {
    const { start, end } = localDayBounds(Date.UTC(2026, 10, 1, 15), NY);
    expect(start).toBe(Date.UTC(2026, 10, 1, 4)); // 00:00 EDT
    expect(end).toBe(Date.UTC(2026, 10, 2, 5)); // 00:00 EST
    expect(end - start).toBe(DAY_MS + 3_600_000);
    expect(localDayNumber(end, NY) - localDayNumber(start, NY)).toBe(1);
    expect(localDayNumber(end - 1, NY)).toBe(localDayNumber(start, NY));
  });
});

describe('fecha de calendario (AG6)', () => {
  it('el inicio de una fecha es su medianoche local, también en zonas lejanas de UTC', () => {
    expect(startOfLocalDate('2026-11-05', MX)).toBe(Date.UTC(2026, 10, 5, 6));
    expect(startOfLocalDate('2026-11-05', 'Pacific/Kiritimati')).toBe(Date.UTC(2026, 10, 4, 10)); // UTC+14
    expect(startOfLocalDate('2026-11-05', 'Pacific/Pago_Pago')).toBe(Date.UTC(2026, 10, 5, 11)); // UTC−11
  });

  it('el día del cambio de horario empieza a su medianoche y la fecha vuelve igual', () => {
    expect(startOfLocalDate('2026-11-01', NY)).toBe(Date.UTC(2026, 10, 1, 4)); // aún EDT
    expect(startOfLocalDate('2026-11-02', NY)).toBe(Date.UTC(2026, 10, 2, 5)); // ya EST
    for (const date of ['2026-10-31', '2026-11-01', '2026-11-02', '2026-03-08']) {
      expect(localDateOf(startOfLocalDate(date, NY), NY)).toBe(date);
    }
  });

  it('acepta solo YYYY-MM-DD', () => {
    expect(LocalDateSchema.safeParse('2026-11-05').success).toBe(true);
    expect(LocalDateSchema.safeParse('2026-13-05').success).toBe(false);
    expect(LocalDateSchema.safeParse('5/11/2026').success).toBe(false);
  });
});
