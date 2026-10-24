import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * FRONTEND FE6: mientras alguien retiene el candado, la PWA no activa una versión nueva (R13: no
 * cortar un intento de recuperación). Lo retienen la sesión de estudio (desde su store, porque
 * sigue viva tras "Salir") y el simulacro en pantalla. El temporizador corre dentro de la sesión;
 * si la app se reinicia, sigue por sus marcas de tiempo (FE11) y un reinicio no lo corta.
 */
interface SessionLockState {
  readonly holders: number;
  /** Devuelve con qué soltarlo; soltarlo dos veces no cuenta doble. */
  hold(): () => void;
}

export const useSessionLock = create<SessionLockState>()((set) => ({
  holders: 0,
  hold: () => {
    set((s) => ({ holders: s.holders + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ holders: s.holders - 1 }));
    };
  },
}));

/** Retiene la actualización mientras `active`. */
export function useHoldSessionLock(active: boolean): void {
  useEffect(() => (active ? useSessionLock.getState().hold() : undefined), [active]);
}
