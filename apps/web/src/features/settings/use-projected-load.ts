import { useEffect, useState } from 'react';
import { projectionWorker } from '@/workers/projection';
import type { LoadProjectionInput } from '@/workers/projection-api';
import { loadProjectionInput } from './queries';

/** Espera tras mover el control antes de pedir el cálculo (UI, no es un umbral de estudio). */
const SETTLE_MS = 250;

export interface ProjectedLoad {
  /** Sin Worker no se calcula (FE4) y la carga no se muestra. */
  readonly available: boolean;
  /** Repasos al día por retención en puntos (90 = 0.90); falta mientras se calcula. */
  readonly perDay: ReadonlyMap<number, number>;
  readonly days: number | null;
  readonly cards: number | null;
  readonly failed: boolean;
  readonly retry: () => void;
}

/**
 * R2 y LD8: carga proyectada para cada retención pedida, calculada en el worker (FE4). Los
 * datos se leen una vez y cada valor se calcula una sola vez: volver a uno ya visto es inmediato.
 */
export function useProjectedLoad(points: readonly number[]): ProjectedLoad {
  const [input, setInput] = useState<LoadProjectionInput | null>(null);
  const [perDay, setPerDay] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const worker = projectionWorker();

  useEffect(() => {
    let cancelled = false;
    loadProjectionInput()
      .then((loaded) => {
        if (!cancelled) setInput(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const missing = [...new Set(points)].filter((p) => !perDay.has(p)).sort((a, b) => a - b);
  const key = missing.join(',');
  useEffect(() => {
    if (!input || !worker || key === '') return;
    const handle = window.setTimeout(() => {
      worker
        .projectLoads(
          input,
          key.split(',').map((p) => Number(p) / 100),
        )
        .then((loads) => {
          // Un valor ya calculado sirve aunque ella haya movido el control mientras tanto.
          setPerDay((prev) => {
            const next = new Map(prev);
            for (const load of loads) next.set(Math.round(load.requestRetention * 100), load.reviewsPerDay);
            return next;
          });
        })
        .catch(() => {
          setFailed(true);
        });
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [input, worker, key, attempt]);

  return {
    available: worker !== null,
    perDay,
    days: input?.config.fsrs.projectionDays ?? null,
    cards: input?.cards.length ?? null,
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    },
  };
}
