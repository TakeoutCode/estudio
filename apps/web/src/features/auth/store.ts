import type { SessionResponse } from '@estudio/shared';
import { create } from 'zustand';

/** FRONTEND FE2: el access token vive solo en memoria; nunca en Dexie ni en localStorage. */
interface AuthState {
  readonly session: SessionResponse | null;
  signIn(session: SessionResponse): void;
  signOut(): void;
}

export const useAuth = create<AuthState>()((set) => ({
  session: null,
  signIn: (session) => {
    set({ session });
  },
  signOut: () => {
    set({ session: null });
  },
}));
