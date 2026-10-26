import type { TimerBlockRecord } from '@estudio/srs';
import { create } from 'zustand';
import type { TimerResult } from './commands';

/** §3: el bloque que se interrumpió con la app cerrada, para preguntarle al volver al estudio. */
export interface AwayBlock {
  readonly sessionId: string;
  readonly interrupted: TimerBlockRecord;
}

interface TimerAwayState {
  readonly away: AwayBlock | null;
  readonly setAway: (away: AwayBlock | null) => void;
}

/**
 * FRONTEND FE2: estado efímero. El tick que detecta la vuelta puede correr en cualquier
 * pantalla (`TimerKeepAlive`), y la pregunta se hace en la de estudio.
 */
export const useTimerAway = create<TimerAwayState>()((set) => ({
  away: null,
  setAway: (away) => {
    set({ away });
  },
}));

/** Guarda el bloque interrumpido mientras la app estuvo cerrada (§3, "cierre de la app a mitad"). */
export function reportTimerResult(result: TimerResult): void {
  if (result.notice === 'interrupted_while_away' && result.closed) {
    useTimerAway.getState().setAway({ sessionId: result.sessionId, interrupted: result.closed });
  }
}
