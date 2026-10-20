import { create } from 'zustand';
import type { SyncState } from './scheduler';

/** Estado visible de la sync (FRONTEND FE2: efímero, no se persiste). */
interface SyncStatus {
  readonly state: SyncState;
  readonly lastSyncedAt: number | null;
  setState(state: SyncState, at: number): void;
}

export const useSyncStatus = create<SyncStatus>()((set) => ({
  state: 'idle',
  lastSyncedAt: null,
  setState: (state, at) => {
    set((current) => ({ state, lastSyncedAt: state === 'idle' ? at : current.lastSyncedAt }));
  },
}));
