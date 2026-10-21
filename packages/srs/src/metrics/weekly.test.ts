import {
  type Confidence,
  defaultStudyConfig,
  type MetricsConfig,
  Rating,
  type ReviewLog,
} from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import {
  DAY,
  HOUR,
  id,
  log,
  newCard,
  NOW,
  range,
  reviewCard,
  TODAY_START,
  TZ,
} from '../test/planner-fixtures.js';
import {
  activeTimeMs,
  calibration,
  dueForecast,
  proportion,
  realRetention,
  weeklyMetrics,
} from './weekly.js';
import { weekWindows } from './windows.js';

const metrics = defaultStudyConfig().metrics;
const MIN = 60_000;
const at = (reviewedAt: number, opts: Partial<ReviewLog> = {}): ReviewLog => ({
  ...log(reviewedAt, opts.rating ?? Rating.Good),
  ...opts,
});
const withMetrics = (patch: Partial<MetricsConfig>) => {
  const base = defaultStudyConfig();
  return { ...base, metrics: { ...base.metrics, ...patch } };
};

describe('R21: tiempo activo', () => {
  const session = id(1, 's');

  it('R21: un hueco de 10 min suma solo hasta `inactivityCutoffSec`', () => {
    const logs = [
      at(NOW, { sessionId: session, durationMs: 20_000 }),
      at(NOW + 30_000, { sessionId: session }),
      at(NOW + 30_000 + 10 * MIN, { sessionId: session }),
    ];
    expect(activeTimeMs(logs, metrics)).toBe(20_000 + 30_000 + 90_000);
    expect(activeTimeMs(logs, { inactivityCutoffSec: 300 })).toBe(20_000 + 30_000 + 300_000);
  });

  it('R21: la primera respuesta aporta su duración con el mismo tope; las sesiones no se unen', () => {
    const logs = [
      at(NOW, { sessionId: session, durationMs: 5 * MIN }),
      at(NOW + 40_000, { sessionId: id(2, 's'), durationMs: 10_000 }),
    ];
    expect(activeTimeMs(logs, metrics)).toBe(90_000 + 10_000);
    expect(activeTimeMs([], metrics)).toBe(0);
  });

  it('R21: el orden de llegada no importa', () => {
    const logs = range(0, 5).map((i) => at(NOW + i * 20_000, { sessionId: session, durationMs: 15_000 }));
    expect(activeTimeMs([...logs].reverse(), metrics)).toBe(activeTimeMs(logs, metrics));
  });
});

describe('§5: retención real e incertidumbre', () => {
  it('§5: cuenta Good y Easy en repasos de tarjetas aprendidas; Hard y los `learn` no', () => {
    const logs = [
      at(NOW, { rating: Rating.Good }),
      at(NOW, { rating: Rating.Easy }),
      at(NOW, { rating: Rating.Hard }),
      at(NOW, { rating: Rating.Again }),
      at(NOW, { rating: Rating.Good, type: 'learn' }),
    ];
    expect(realRetention(logs)).toMatchObject({ successes: 2, total: 4, rate: 0.5 });
  });

  it('§5: el intervalo de Wilson muestra la incertidumbre y se angosta con más datos', () => {
    const few = proportion(8, 10);
    expect(few.low).toBeCloseTo(0.4902, 3);
    expect(few.high).toBeCloseTo(0.9433, 3);
    const many = proportion(800, 1000);
    expect((many.high ?? 0) - (many.low ?? 0)).toBeLessThan((few.high ?? 0) - (few.low ?? 0));
    expect(proportion(0, 0)).toEqual({ successes: 0, total: 0, rate: null, low: null, high: null });
    expect(proportion(5, 5).high).toBe(1);
  });
});

describe('§5, R6: calibración', () => {
  const answer = (confidence: Confidence, rating: Rating, type: ReviewLog['type'] = 'review') =>
    at(NOW, { confidence, rating, type });
  const repeat = (n: number, make: () => ReviewLog) => range(0, n).map(make);

  it('§5: más confianza que aciertos es "over"; menos, "under"; parecidas, "aligned"', () => {
    const over = [...repeat(15, () => answer(3, Rating.Again)), ...repeat(5, () => answer(3, Rating.Good))];
    expect(calibration(over, metrics)).toMatchObject({ samples: 20, tendency: 'over' });
    expect(calibration(over, metrics)?.bias).toBeCloseTo(0.75);
    const under = repeat(20, () => answer(1, Rating.Good));
    expect(calibration(under, metrics)?.tendency).toBe('under');
    const aligned = [
      ...repeat(10, () => answer(3, Rating.Good)),
      ...repeat(10, () => answer(1, Rating.Again)),
    ];
    expect(calibration(aligned, metrics)).toMatchObject({ bias: 0, tendency: 'aligned' });
  });

  it('§5: la gamma mide si la confianza distingue aciertos de fallos', () => {
    const distinguishes = [
      ...repeat(10, () => answer(3, Rating.Good)),
      ...repeat(10, () => answer(1, Rating.Again)),
    ];
    expect(calibration(distinguishes, metrics)).toMatchObject({ gamma: 1, resolution: 'distinguishes' });
    const inverted = [
      ...repeat(10, () => answer(1, Rating.Good)),
      ...repeat(10, () => answer(3, Rating.Again)),
    ];
    expect(calibration(inverted, metrics)).toMatchObject({ gamma: -1, resolution: 'weak' });
    const flat = repeat(20, () => answer(2, Rating.Good));
    expect(calibration(flat, metrics)).toMatchObject({ gamma: null, resolution: null });
  });

  it('P7: en simulacros, el acierto con poca confianza (Hard) cuenta como acierto', () => {
    const exams = repeat(20, () => answer(1, Rating.Hard, 'exam'));
    expect(calibration(exams, metrics)?.tendency).toBe('under');
  });

  it('AG4: muestras mínimas, margen y gamma salen de la config', () => {
    const logs = [...repeat(12, () => answer(3, Rating.Good)), ...repeat(8, () => answer(2, Rating.Again))];
    // confianza media 0.8, acierto 0.6: sesgo 0.2; gamma 1
    expect(calibration(logs.slice(0, 19), metrics)).toBeNull();
    expect(calibration(logs.slice(0, 5), { ...metrics, calibrationMinSamples: 5 })).not.toBeNull();
    expect(calibration(logs, metrics)?.tendency).toBe('over');
    expect(calibration(logs, { ...metrics, calibrationBiasMargin: 0.25 })?.tendency).toBe('aligned');
    expect(calibration(logs, { ...metrics, calibrationResolutionMin: 1 })?.resolution).toBe('distinguishes');
    // Algunos fallos con mucha confianza y aciertos con poca: gamma = (96 − 16) / 112 ≈ 0.71.
    const mixed = [
      ...logs,
      ...repeat(4, () => answer(3, Rating.Again)),
      ...repeat(4, () => answer(2, Rating.Good)),
    ];
    expect(calibration(mixed, metrics)?.gamma).toBeCloseTo(80 / 112);
    expect(calibration(mixed, metrics)?.resolution).toBe('distinguishes');
    expect(calibration(mixed, { ...metrics, calibrationResolutionMin: 0.8 })?.resolution).toBe('weak');
  });

  it('sin confianza registrada no hay calibración', () => {
    expect(
      calibration(
        repeat(40, () => at(NOW)),
        metrics,
      ),
    ).toBeNull();
  });
});

describe('§5: carga como pendientes', () => {
  const planner = defaultStudyConfig().planner;

  it('§5: hoy cuenta como la cola; luego lo que vence cada día; sin nuevas ni para reformular', () => {
    const cards = [
      reviewCard(1, { due: NOW - 3 * DAY }), // atraso: hoy
      reviewCard(2, { due: TODAY_START + 20 * HOUR }), // más tarde hoy: hoy
      reviewCard(3, { due: TODAY_START + DAY + HOUR }), // mañana
      reviewCard(4, { due: TODAY_START + 2 * DAY + HOUR, lapses: 6 }), // reformular
      newCard(5),
    ];
    const forecast = dueForecast(cards, planner, NOW, TZ, 3);
    expect(forecast).toEqual([
      { day: TODAY_START, count: 2 },
      { day: TODAY_START + DAY, count: 1 },
      { day: TODAY_START + 2 * DAY, count: 0 },
    ]);
    expect(dueForecast(cards, { leechLapses: 7 }, NOW, TZ, 3)[2]?.count).toBe(1);
  });
});

describe('§5: semanas locales y línea base', () => {
  it('AG6: 7 días locales que terminan al acabar hoy, también con un día de 25 horas', () => {
    const [week] = weekWindows(NOW, TZ, 1);
    expect(week).toEqual({ start: TODAY_START - 6 * DAY, end: TODAY_START + DAY });
    // Nueva York deja el horario de verano el 1 de noviembre de 2026.
    const [ny] = weekWindows(Date.UTC(2026, 10, 3, 17), 'America/New_York', 1);
    expect(ny).toEqual({ start: Date.UTC(2026, 9, 28, 4), end: Date.UTC(2026, 10, 4, 5) });
  });

  const input = (logs: ReviewLog[], patch: Partial<MetricsConfig> = {}) =>
    weeklyMetrics({
      logs,
      cards: [],
      sleepLogs: [],
      config: withMetrics(patch),
      now: NOW,
      timeZone: TZ,
      forecastDays: 7,
    });
  const daily = (daysAgo: number, count: number, rating: Rating = Rating.Good) =>
    range(0, count).map((i) =>
      at(TODAY_START - daysAgo * DAY + 10 * HOUR + i * 30_000, {
        sessionId: id(daysAgo, 's'),
        rating,
        durationMs: 30_000,
      }),
    );

  it('UX9: con menos de `minReviewsToShow` repasos no hay datos suficientes', () => {
    expect(input(daily(0, 99)).enoughData).toBe(false);
    expect(input(daily(0, 100)).enoughData).toBe(true);
    expect(input(daily(0, 50), { minReviewsToShow: 50 }).enoughData).toBe(true);
  });

  it('UX9: compara con sus semanas previas (rango), solo desde que usa la app', () => {
    const logs = [...daily(0, 20), ...daily(8, 10), ...daily(15, 40, Rating.Again)];
    const result = input(logs);
    expect(result.activeTime.weekMs).toBe(20 * 30_000);
    expect(result.baselineWeeks).toBe(2); // la de hace 3-4 semanas es anterior al primer repaso
    expect(result.activeTime.baseline).toEqual({ minMs: 10 * 30_000, maxMs: 40 * 30_000 });
    expect(result.retention.week).toMatchObject({ total: 20, rate: 1 });
    expect(result.retention.baseline).toMatchObject({ total: 50, successes: 10 });
    expect(result.retention.target).toBe(0.9);
    expect(input(logs, { baselineWeeks: 1 }).activeTime.baseline).toEqual({ minMs: 300_000, maxMs: 300_000 });
  });

  it('sin semanas previas no hay línea base', () => {
    const result = input(daily(0, 5));
    expect(result.activeTime.baseline).toBeNull();
    expect(result.retention.baseline).toBeNull();
  });

  it('§5: el resumen incluye el sueño anotado, sin mezclarlo con los repasos', () => {
    const today = weeklyMetrics({
      logs: [],
      cards: [],
      sleepLogs: [{ date: '2026-10-20', quality: 4 }],
      config: withMetrics({ sleepMinNights: 1 }),
      now: NOW,
      timeZone: TZ,
      forecastDays: 7,
    });
    expect(today.sleep).toEqual({ week: { nights: 1, median: 4 }, enoughData: true, baseline: null });
    expect(today.enoughData).toBe(false); // los repasos siguen decidiendo "pocos datos"
  });
});
