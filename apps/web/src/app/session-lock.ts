import { create } from 'zustand';

/**
 * ¿Hay una sesión de estudio o un bloque del temporizador en curso? Mientras sí, la PWA no
 * se actualiza (FRONTEND FE6, R13: no cortar un intento de recuperación).
 */
interface SessionLockState {
  readonly active: boolean;
  setActive(active: boolean): void;
}

export const useSessionLock = create<SessionLockState>()((set) => ({
  active: false,
  setActive: (active) => {
    set({ active });
  },
}));
