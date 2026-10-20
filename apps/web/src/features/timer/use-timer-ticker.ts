import { isTimerActive } from '@estudio/shared';
import { useEffect, useRef, useState } from 'react';
import { dispatchTimer, type TimerResult } from './commands';
import type { TimerView } from './queries';

/** FRONTEND FE11: el intervalo solo repinta; el tiempo siempre sale de las marcas. */
const REPAINT_MS = 1_000;

/**
 * Repinta cada segundo y, en el dispositivo dueño, manda `tick` a la máquina: así cierra el
 * bloque al llegar a 0 (R13 con `cardInProgress`) y detecta la vuelta tras tener la app
 * cerrada (§3). También al volver a primer plano, porque iOS congela los timers.
 * Devuelve `Date.now()` del último repintado (hora del dispositivo).
 */
export function useTimerTicker(
  view: TimerView | undefined,
  cardInProgress: boolean,
  onResult: (result: TimerResult) => void,
): number {
  const [now, setNow] = useState(0);
  const card = useRef(cardInProgress);
  const report = useRef(onResult);
  const inflight = useRef(false);
  useEffect(() => {
    card.current = cardInProgress;
    report.current = onResult;
  });

  const drives = view?.session ? view.isOwner && isTimerActive(view.session) : false;
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (!drives || inflight.current) return;
      inflight.current = true;
      void dispatchTimer({ type: 'tick', cardInProgress: card.current })
        .then((result) => {
          if (result?.notice || result?.closed) report.current(result);
        })
        .finally(() => {
          inflight.current = false;
        });
    };
    tick();
    const handle = window.setInterval(tick, REPAINT_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [drives]);
  return now;
}
