import { PullResponseSchema, PushResponseSchema } from '@estudio/shared';
import { db } from '@/db/schema';
import { authorizedApi, useAuth } from '@/features/auth';
import { syncOnce, type SyncTransport } from './engine';
import { SYNC_TIMING, SyncScheduler } from './scheduler';
import { useSyncStatus } from './status';

export { useSyncStatus } from './status';
export type { SyncState } from './scheduler';

const httpTransport: SyncTransport = {
  push: (request) =>
    authorizedApi('/sync/push', { method: 'POST', body: request, schema: PushResponseSchema }),
  pull: (cursor) => authorizedApi(`/sync/pull?cursor=${cursor}`, { schema: PullResponseSchema }),
};

const exclusive = (task: () => Promise<void>): Promise<void> =>
  'locks' in navigator
    ? navigator.locks.request('estudio-sync', { ifAvailable: true }, async (lock) => {
        if (lock) await task();
      })
    : task();

export const syncScheduler = new SyncScheduler(() => syncOnce(db, httpTransport), {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle as number);
  },
  random: Math.random,
  isOnline: () => navigator.onLine,
  hasSession: () => useAuth.getState().session !== null,
  exclusive,
  onState: (state) => {
    useSyncStatus.getState().setState(state, Date.now());
  },
});

let started = false;

/** SY8: dispara la sync al abrir, al volver la red o la app y cada minuto con la app visible. */
export function startSync(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    syncScheduler.now();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncScheduler.now();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') syncScheduler.now();
  }, SYNC_TIMING.visibleIntervalMs);
  // Al iniciar sesión (o renovarla tras un 401) la sync se reanuda.
  useAuth.subscribe((state, previous) => {
    if (state.session && !previous.session) syncScheduler.resume();
  });
  syncScheduler.now();
}
