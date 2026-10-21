import {
  type Confidence,
  localDayBounds,
  type MetricsConfig,
  type PlannerConfig,
  Rating,
  type ReviewLog,
  type StudyConfig,
} from '@estudio/shared';
import { byReviewOrder } from '../fsrs/scheduler.js';
import { isLearnedReview, isRecalled } from '../planner/history.js';
import { isLeech, type PlannerCard } from '../planner/queue.js';

// Métricas de STUDY-METHODS §5, mostradas sin ansiedad (UI-UX UX9): por semana, contra su
// propia línea base, con incertidumbre y solo con datos suficientes. Funciones puras: corren
// en el worker de la web (FRONTEND FE4).

const SECOND_MS = 1_000;
const WEEK_DAYS = 7;
/** Intervalo de confianza del 95 % (estadística, no es un umbral de estudio). */
const Z_95 = 1.96;

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

const within = (logs: readonly ReviewLog[], w: TimeWindow) =>
  logs.filter((log) => log.reviewedAt >= w.start && log.reviewedAt < w.end);

/**
 * R21 y §3: tiempo activo = suma de los intervalos entre respuestas de cada sesión, cada uno
 * con tope `inactivityCutoffSec`. La primera respuesta de una sesión aporta su duración, con
 * el mismo tope. El tiempo declarado fuera de la app (`manual`) no entra aquí.
 */
export function activeTimeMs(
  logs: readonly ReviewLog[],
  cfg: Pick<MetricsConfig, 'inactivityCutoffSec'>,
): number {
  const cutoff = cfg.inactivityCutoffSec * SECOND_MS;
  const bySession = new Map<string, ReviewLog[]>();
  for (const log of logs) {
    const session = bySession.get(log.sessionId);
    if (session) session.push(log);
    else bySession.set(log.sessionId, [log]);
  }
  let total = 0;
  for (const session of bySession.values()) {
    const ordered = session.sort(byReviewOrder);
    ordered.forEach((log, i) => {
      const previous = ordered[i - 1];
      const span = previous ? log.reviewedAt - previous.reviewedAt : log.durationMs;
      total += Math.min(Math.max(0, span), cutoff);
    });
  }
  return total;
}

export interface Proportion {
  readonly successes: number;
  readonly total: number;
  /** null sin datos. */
  readonly rate: number | null;
  /** Intervalo de Wilson al 95 %: "mostrar incertidumbre" (§5). */
  readonly low: number | null;
  readonly high: number | null;
}

export function proportion(successes: number, total: number): Proportion {
  if (total === 0) return { successes, total, rate: null, low: null, high: null };
  const p = successes / total;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (Z_95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator;
  return {
    successes,
    total,
    rate: p,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

/** §5: % de Good y Easy en repasos de tarjetas ya aprendidas (logs `review` y `contrast`). */
export function realRetention(logs: readonly ReviewLog[]): Proportion {
  const reviews = logs.filter((log) => isLearnedReview(log.type));
  return proportion(reviews.filter((log) => isRecalled(log.rating)).length, reviews.length);
}

export type CalibrationTendency = 'over' | 'under' | 'aligned';
export type CalibrationResolution = 'distinguishes' | 'weak';

export interface Calibration {
  readonly samples: number;
  /** Confianza media (1-3 llevada a 0-1) − acierto (0-1). Positivo: más confianza que aciertos. */
  readonly bias: number;
  /** Gamma de Goodman-Kruskal entre confianza y acierto; null si no hay pares que comparar. */
  readonly gamma: number | null;
  readonly tendency: CalibrationTendency;
  readonly resolution: CalibrationResolution | null;
}

type CalibrationConfig = Pick<
  MetricsConfig,
  'calibrationMinSamples' | 'calibrationBiasMargin' | 'calibrationResolutionMin'
>;

/** Una respuesta con la confianza que dio antes de ver la respuesta (R6). */
export interface ConfidencePair {
  readonly confidence: Confidence;
  readonly correct: boolean;
}

/**
 * §5, R6: sesgo y resolución de las respuestas con confianza. En simulacros, acertar es todo
 * lo que no fue `Again` (P7 da Hard al acierto con poca confianza); en repasos, recordar según
 * §5 (Good o Easy). Con menos de `calibrationMinSamples` respuestas devuelve null.
 */
export function calibration(logs: readonly ReviewLog[], cfg: CalibrationConfig): Calibration | null {
  return calibrationOf(
    logs.flatMap((log) =>
      log.confidence === null
        ? []
        : [
            {
              confidence: log.confidence,
              correct: log.type === 'exam' ? log.rating !== Rating.Again : isRecalled(log.rating),
            },
          ],
    ),
    cfg,
  );
}

/** §5: lo mismo a partir de pares confianza-acierto (p. ej. las preguntas de un simulacro). */
export function calibrationOf(rated: readonly ConfidencePair[], cfg: CalibrationConfig): Calibration | null {
  if (rated.length < cfg.calibrationMinSamples) return null;

  // Tabla confianza (1-3) × acierto (0/1).
  const table = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  let confidenceSum = 0;
  let hits = 0;
  for (const { confidence, correct } of rated) {
    const hit = correct ? 1 : 0;
    const row = table[confidence - 1];
    if (row) row[hit] = (row[hit] ?? 0) + 1;
    confidenceSum += (confidence - 1) / 2;
    hits += hit;
  }
  const cell = (c: number, hit: number) => table[c]?.[hit] ?? 0;
  let concordant = 0;
  let discordant = 0;
  for (let high = 1; high < 3; high += 1) {
    for (let low = 0; low < high; low += 1) {
      concordant += cell(high, 1) * cell(low, 0);
      discordant += cell(high, 0) * cell(low, 1);
    }
  }
  const pairs = concordant + discordant;
  const gamma = pairs === 0 ? null : (concordant - discordant) / pairs;
  const bias = confidenceSum / rated.length - hits / rated.length;
  return {
    samples: rated.length,
    bias,
    gamma,
    tendency:
      bias > cfg.calibrationBiasMargin ? 'over' : bias < -cfg.calibrationBiasMargin ? 'under' : 'aligned',
    resolution: gamma === null ? null : gamma >= cfg.calibrationResolutionMin ? 'distinguishes' : 'weak',
  };
}

export interface DayCount {
  /** Inicio del día local. */
  readonly day: number;
  readonly count: number;
}

/**
 * §5 "carga" (P2, P8), como "pendientes": hoy cuenta igual que la cola (repasos que vencen
 * hoy, incluido el atraso, y pasos de aprendizaje ya vencidos); los días siguientes, lo que
 * vence en cada uno. Sin nuevas ni tarjetas para reformular (P3).
 */
export function dueForecast(
  cards: readonly Pick<PlannerCard, 'state' | 'lapseBaseline'>[],
  cfg: Pick<PlannerConfig, 'leechLapses'>,
  now: number,
  timeZone: string,
  days: number,
): DayCount[] {
  const active = cards.filter((card) => card.state.phase !== 'new' && !isLeech(card, cfg));
  const today = localDayBounds(now, timeZone);
  const out: DayCount[] = [
    {
      day: today.start,
      count: active.filter(({ state: s }) => (s.phase === 'review' ? s.due < today.end : s.due <= now))
        .length,
    },
  ];
  let start = today.end;
  for (let d = 1; d < days; d += 1) {
    const end = localDayBounds(start, timeZone).end;
    out.push({ day: start, count: active.filter(({ state: s }) => s.due >= start && s.due < end).length });
    start = end;
  }
  return out;
}

export interface WeeklyMetricsInput {
  /** Todo el historial: el total decide si hay datos suficientes (§5). */
  readonly logs: readonly ReviewLog[];
  readonly cards: readonly Pick<PlannerCard, 'state' | 'lapseBaseline'>[];
  readonly config: StudyConfig;
  readonly now: number;
  readonly timeZone: string;
  /** Días de pendientes a mostrar desde hoy. */
  readonly forecastDays: number;
}

export interface WeeklyMetrics {
  /** UX9: con menos de `minReviewsToShow` repasos, "Pocos datos todavía". */
  readonly enoughData: boolean;
  readonly totalReviews: number;
  readonly week: TimeWindow;
  /** Semanas previas con uso de la app que forman la línea base (hasta `baselineWeeks`). */
  readonly baselineWeeks: number;
  readonly activeTime: {
    readonly weekMs: number;
    /** Rango de sus semanas previas; null si todavía no hay. */
    readonly baseline: { readonly minMs: number; readonly maxMs: number } | null;
  };
  readonly retention: {
    readonly week: Proportion;
    readonly baseline: Proportion | null;
    readonly target: number;
  };
  readonly calibration: Calibration | null;
  readonly load: readonly DayCount[];
}

/** §5: el resumen de los últimos 7 días contra sus `baselineWeeks` semanas previas. */
export function weeklyMetrics(input: WeeklyMetricsInput): WeeklyMetrics {
  const { config, logs, now, timeZone } = input;
  const m = config.metrics;
  const [week, ...previous] = weekWindows(now, timeZone, 1 + m.baselineWeeks);
  if (!week) throw new RangeError('no_week');
  // Solo cuentan las semanas en que ya usaba la app: antes no hay nada que comparar.
  const first = logs.reduce<number | null>(
    (min, log) => Math.min(min ?? log.reviewedAt, log.reviewedAt),
    null,
  );
  const baseline = previous.filter((w) => first !== null && w.end > first);
  const weekLogs = within(logs, week);
  const baselineTimes = baseline.map((w) => activeTimeMs(within(logs, w), m));

  return {
    enoughData: logs.length >= m.minReviewsToShow,
    totalReviews: logs.length,
    week,
    baselineWeeks: baseline.length,
    activeTime: {
      weekMs: activeTimeMs(weekLogs, m),
      baseline:
        baselineTimes.length === 0
          ? null
          : { minMs: Math.min(...baselineTimes), maxMs: Math.max(...baselineTimes) },
    },
    retention: {
      week: realRetention(weekLogs),
      baseline: baseline.length === 0 ? null : realRetention(baseline.flatMap((w) => within(logs, w))),
      target: config.fsrs.requestRetention,
    },
    calibration: calibration(weekLogs, m),
    load: dueForecast(input.cards, config.planner, now, timeZone, input.forecastDays),
  };
}
