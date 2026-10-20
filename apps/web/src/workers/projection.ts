import { type Remote, wrap } from 'comlink';
import type { ProjectionApi } from './projection-api';

let remote: Remote<ProjectionApi> | undefined;

/**
 * FRONTEND FE4: el worker de proyección, creado al primer uso. Sin Worker (jsdom en las
 * pruebas) devuelve null y quien llama no calcula: el replay completo nunca va al hilo principal.
 */
export function projectionWorker(): Remote<ProjectionApi> | null {
  if (typeof Worker === 'undefined') return null;
  remote ??= wrap<ProjectionApi>(
    new Worker(new URL('./projection.worker.ts', import.meta.url), { type: 'module' }),
  );
  return remote;
}
