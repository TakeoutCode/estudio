import type { GamificationSummary } from '@estudio/srs';
import { useEffect, useState } from 'react';
import { projectionWorker } from '@/workers/projection';
import { useGamificationConfig, useGamificationInput } from './queries';

export type GamificationView =
  | { readonly status: 'loading' }
  /** Apagada o sin responder (UX10): no se calcula ni se muestra nada. */
  | { readonly status: 'off' }
  /** Sin Worker no se calcula (FE4). */
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly summary: GamificationSummary };

/** UX10: XP, nivel, monedas, logros y racha, calculados en el worker (FE4) cuando cambian sus datos. */
export function useGamification(): GamificationView {
  const config = useGamificationConfig();
  const enabled = config?.enabled === true;
  const input = useGamificationInput(enabled);
  const [view, setView] = useState<GamificationView>({ status: 'loading' });

  useEffect(() => {
    const worker = projectionWorker();
    if (!input || !worker) return;
    let cancelled = false;
    worker
      .gamificationSummary(input)
      .then((summary) => {
        if (!cancelled) setView({ status: 'ready', summary });
      })
      .catch(() => {
        if (!cancelled) setView({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [input]);

  if (config === undefined) return { status: 'loading' };
  if (!enabled) return { status: 'off' };
  if (!projectionWorker()) return { status: 'unavailable' };
  return input ? view : { status: 'loading' };
}
