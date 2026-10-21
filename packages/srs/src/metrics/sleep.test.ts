import { defaultStudyConfig, localDateOf, type SleepQuality } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, NOW, TODAY_START, TZ } from '../test/planner-fixtures.js';
import { sleepSummary } from './sleep.js';

const metrics = defaultStudyConfig().metrics;
/** Noche anotada `daysAgo` días locales antes de hoy, a media mañana. */
const night = (daysAgo: number, quality: SleepQuality, timeZone = TZ) => ({
  date: localDateOf(TODAY_START - daysAgo * DAY + 3 * HOUR, timeZone),
  quality,
});

describe('§5: resumen del sueño (opcional, sin gamificar)', () => {
  it('UX9: con menos de `sleepMinNights` noches en la semana hay pocos datos', () => {
    const two = [night(0, 4), night(1, 3)];
    expect(sleepSummary(two, metrics, NOW, TZ)).toMatchObject({
      week: { nights: 2, median: 3.5 },
      enoughData: false,
    });
    expect(sleepSummary([...two, night(6, 5)], metrics, NOW, TZ).enoughData).toBe(true);
    // El mínimo es configurable (AG4): con 1 noche basta si ella lo elige.
    expect(sleepSummary([night(0, 2)], { ...metrics, sleepMinNights: 1 }, NOW, TZ).enoughData).toBe(true);
    expect(sleepSummary([], metrics, NOW, TZ).week).toEqual({ nights: 0, median: null });
  });

  it('AG6: la semana son los 7 días locales que terminan hoy; hace 7 días ya es la anterior', () => {
    const result = sleepSummary([night(0, 5), night(6, 1), night(7, 3)], metrics, NOW, TZ);
    expect(result.week).toEqual({ nights: 2, median: 3 });
    // A las 23:30 de hoy en CDMX sigue siendo hoy, aunque en UTC ya sea mañana.
    const late = TODAY_START + 23 * HOUR + 30 * 60_000;
    expect(sleepSummary([night(0, 4)], metrics, late, TZ).week.nights).toBe(1);
  });

  it('compara con sus semanas previas juntas, solo con noches suficientes', () => {
    const previous = [night(8, 2), night(10, 3), night(20, 4)];
    const week = [night(0, 4), night(1, 4), night(2, 5)];
    expect(sleepSummary([...week, ...previous], metrics, NOW, TZ).baseline).toEqual({ nights: 3, median: 3 });
    // Con una sola semana de línea base, la de hace 20 días queda fuera.
    expect(
      sleepSummary([...week, ...previous], { ...metrics, baselineWeeks: 1 }, NOW, TZ).baseline,
    ).toBeNull();
    expect(sleepSummary(week, metrics, NOW, TZ).baseline).toBeNull();
  });

  it('las noches de más allá de la línea base no cuentan', () => {
    const old = night(7 * (1 + metrics.baselineWeeks), 1);
    expect(sleepSummary([old], { ...metrics, sleepMinNights: 1 }, NOW, TZ).baseline).toBeNull();
  });
});
