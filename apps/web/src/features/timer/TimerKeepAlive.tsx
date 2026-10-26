import { useTimerView } from './queries';
import { reportTimerResult } from './store';
import { useTimerTicker } from './use-timer-ticker';

/**
 * STUDY-METHODS §3: con la app abierta en otra pantalla (reformular una tarjeta, revisar Hoy), el
 * temporizador sigue su curso. Sin estos ticks, al volver tras más de `pauseTimeoutMin` el hueco
 * se leía como la app cerrada y el bloque quedaba interrumpido. Va fuera de la pantalla de
 * estudio, que tiene su propio ticker; con la app en segundo plano iOS lo congela y el hueco sí
 * cuenta, como debe.
 */
export function TimerKeepAlive() {
  useTimerTicker(useTimerView(), false, reportTimerResult);
  return null;
}
