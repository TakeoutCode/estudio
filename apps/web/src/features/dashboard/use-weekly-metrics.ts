import type { StudyConfig } from '@estudio/shared';
import type { WeeklyMetrics } from '@estudio/srs';
import { useEffect, useState } from 'react';
import { projectionWorker } from '@/workers/projection';
import { useMetricsInput } from './queries';

export type MetricsView =
  | { readonly status: 'loading' }
  /** Sin Worker no se calcula (FE4). */
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed'; readonly retry: () => void }
  | {
      readonly status: 'ready';
      readonly metrics: WeeklyMetrics;
      readonly config: StudyConfig;
      readonly timeZone: string;
    };

/** §5: el resumen semanal, calculado en el worker (FE4) cada vez que cambian sus datos. */
export function useWeeklyMetrics(): MetricsView {
  const input = useMetricsInput();
  const worker = projectionWorker();
  const [view, setView] = useState<MetricsView>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!input || !worker) return;
    let cancelled = false;
    worker
      .weeklyMetrics(input)
      .then((metrics) => {
        if (!cancelled) setView({ status: 'ready', metrics, config: input.config, timeZone: input.timeZone });
      })
      .catch(() => {
        if (!cancelled) {
          setView({
            status: 'failed',
            retry: () => {
              setView({ status: 'loading' });
              setAttempt((n) => n + 1);
            },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [input, worker, attempt]);

  return worker ? view : { status: 'unavailable' };
}
