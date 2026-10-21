import {
  DAY_MS,
  localDayNumber,
  type PlannerConfig,
  Rating,
  type ReviewLog,
  type StudyConfig,
} from '@estudio/shared';

// Lo que el planificador lee de su historial (STUDY-METHODS §4, §5). Solo funciones puras.

const SECOND_MS = 1_000;

/**
 * Repaso de una tarjeta ya aprendida: el normal y el que se hace dentro de un set de contraste
 * (LD10). Cuentan igual para los tiempos (P1), la retención (P3, §5) y FSRS.
 */
export const isLearnedReview = (type: ReviewLog['type']): boolean => type === 'review' || type === 'contrast';

/** §5: la retención real cuenta Good y Easy como recordadas. */
export const isRecalled = (rating: Rating): boolean => rating >= Rating.Good;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[mid - 1] ?? 0) + upper) / 2);
}

export interface SessionTiming {
  readonly reviewMs: number;
  readonly newMs: number;
  /** `false` mientras usa los tiempos de arranque (P1: 20 s y 60 s). */
  readonly reviewFromHistory: boolean;
  readonly newFromHistory: boolean;
}

/**
 * P1: tiempos medianos de su historial. Un repaso es un log `review` o `contrast`; una nueva es la suma
 * de los logs `learn` de cada tarjeta (todos sus pasos de aprendizaje). Con menos de
 * `timingMinSamples` muestras se usan los tiempos de arranque.
 */
export function sessionTiming(logs: readonly ReviewLog[], cfg: PlannerConfig): SessionTiming {
  const reviews = logs.filter((log) => isLearnedReview(log.type)).map((log) => log.durationMs);
  const learnByCard = new Map<string, number>();
  for (const log of logs) {
    if (log.type === 'learn')
      learnByCard.set(log.cardId, (learnByCard.get(log.cardId) ?? 0) + log.durationMs);
  }
  const news = [...learnByCard.values()];
  const reviewFromHistory = reviews.length >= cfg.timingMinSamples;
  const newFromHistory = news.length >= cfg.timingMinSamples;
  // Un historial con duraciones en 0 no debe dividir por cero en P1.
  const positive = (ms: number | null, fallback: number) => Math.max(1, ms ?? fallback);
  return {
    reviewMs: positive(reviewFromHistory ? median(reviews) : null, cfg.bootstrapReviewSec * SECOND_MS),
    newMs: positive(newFromHistory ? median(news) : null, cfg.bootstrapNewSec * SECOND_MS),
    reviewFromHistory,
    newFromHistory,
  };
}

export interface RetentionWindow {
  readonly reviews: number;
  readonly recalled: number;
  /** P3: hay suficientes repasos y la retención quedó `lowRetentionDropPts` bajo el objetivo. */
  readonly low: boolean;
}

export interface RetentionStatus {
  /** Ventana de `lowRetentionWindowDays` días que termina hoy. */
  readonly current: RetentionWindow;
  /** Días seguidos, hasta hoy, con la ventana baja (tope `lowRetentionPersistDays`). */
  readonly lowStreakDays: number;
}

/**
 * P3: retención de repasos de tarjetas ya aprendidas (logs `review` y `contrast`) por ventanas de días
 * locales. Un día sin repasos suficientes no cuenta como bajo.
 */
export function retentionStatus(
  logs: readonly ReviewLog[],
  now: number,
  timeZone: string,
  cfg: Pick<StudyConfig, 'fsrs' | 'planner'>,
): RetentionStatus {
  const { lowRetentionWindowDays: windowDays, lowRetentionPersistDays: persistDays } = cfg.planner;
  const today = localDayNumber(now, timeZone);
  // Solo hacen falta los días que tocan alguna ventana (+1 por el desfase de zona).
  const since = now - (windowDays + persistDays + 1) * DAY_MS;
  const byDay = new Map<number, { reviews: number; recalled: number }>();
  for (const log of logs) {
    if (!isLearnedReview(log.type) || log.reviewedAt < since || log.reviewedAt > now) continue;
    const day = localDayNumber(log.reviewedAt, timeZone);
    const bucket = byDay.get(day) ?? { reviews: 0, recalled: 0 };
    bucket.reviews += 1;
    if (isRecalled(log.rating)) bucket.recalled += 1;
    byDay.set(day, bucket);
  }
  const threshold = cfg.fsrs.requestRetention * 100 - cfg.planner.lowRetentionDropPts;
  const windowEnding = (lastDay: number): RetentionWindow => {
    let reviews = 0;
    let recalled = 0;
    for (let day = lastDay - windowDays + 1; day <= lastDay; day += 1) {
      reviews += byDay.get(day)?.reviews ?? 0;
      recalled += byDay.get(day)?.recalled ?? 0;
    }
    const low = reviews >= cfg.planner.lowRetentionMinReviews && (recalled / reviews) * 100 < threshold;
    return { reviews, recalled, low };
  };
  let lowStreakDays = 0;
  while (lowStreakDays < persistDays && windowEnding(today - lowStreakDays).low) lowStreakDays += 1;
  return { current: windowEnding(today), lowStreakDays };
}
