import { db } from '@/db/schema';

// Mantiene `cardStates` al día con la configuración de FSRS (ARC5, FRONTEND FE4, SYNC SY4):
// tras guardar otra retención, tras un pull y al abrir la app. Una sola reconstrucción a la
// vez; un pedido que llega mientras corre se atiende con otra pasada al terminar.

let running: Promise<void> | null = null;
let again = false;

/** Revisa la proyección y, si quedó vieja, la reconstruye en el worker. */
export function ensureProjection(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  again = false;
  running = rebuild()
    .catch((error: unknown) => {
      // Se reintenta en el siguiente cambio, pull o arranque; mientras, se usa la que hay.
      console.error(error);
    })
    .finally(() => {
      running = null;
      if (again) void ensureProjection();
    });
  return running;
}

async function rebuild(): Promise<void> {
  // FE9: srs y el worker se cargan solo cuando hace falta.
  const [{ projectionWorker }, { reprojectIfStale }] = await Promise.all([
    import('@/workers/projection'),
    import('@/db/reproject'),
  ]);
  const worker = projectionWorker();
  if (worker) await reprojectIfStale(db, (input) => worker.replayCards(input));
}
