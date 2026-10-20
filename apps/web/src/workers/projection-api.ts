import type { ReviewLog, StudyConfig } from '@estudio/shared';
import {
  type CardState,
  type LoadCard,
  projectReviewLoad,
  type ReplayCard,
  replayCards,
  type ReviewLoad,
  weeklyMetrics,
  type WeeklyMetrics,
  type WeeklyMetricsInput,
} from '@estudio/srs';

// Lo que corre en `projection.worker.ts` (FRONTEND FE4). Vive aparte del worker para probarlo
// sin Worker; el hilo principal solo lo importa como tipo.

export interface LoadProjectionInput {
  readonly cards: readonly LoadCard[];
  readonly logs: readonly ReviewLog[];
  readonly config: StudyConfig;
  readonly now: number;
  readonly timeZone: string;
}

export interface ReplayInput {
  readonly cards: readonly ReplayCard[];
  readonly logs: readonly ReviewLog[];
  readonly config: Pick<StudyConfig, 'fsrs' | 'exam'>;
}

export const projectionApi = {
  /** R2, LD8: repasos al día con cada retención, en el orden pedido. */
  projectLoads(input: LoadProjectionInput, retentions: readonly number[]): ReviewLoad[] {
    return retentions.map((requestRetention) =>
      projectReviewLoad({
        ...input,
        config: { ...input.config, fsrs: { ...input.config.fsrs, requestRetention } },
      }),
    );
  },
  /** ARC5: replay completo tras cambiar la retención (o recibirla por sync). */
  replayCards(input: ReplayInput): CardState[] {
    return replayCards(input.cards, input.logs, input.config);
  },
  /** §5: el resumen semanal. */
  weeklyMetrics(input: WeeklyMetricsInput): WeeklyMetrics {
    return weeklyMetrics(input);
  },
};

export type ProjectionApi = typeof projectionApi;
