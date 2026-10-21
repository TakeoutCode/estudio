import type { BreakEndCancel } from '@estudio/shared';
import { remainingMs } from '@estudio/srs';
import { useEffect, useRef } from 'react';
import { useNotificationPrefs } from '@/features/settings';
import type { TimerView } from '@/features/timer';
import { cancelBreakEnd, scheduleBreakEnd } from './commands';

/**
 * NOTIFICATIONS NT4 y FRONTEND FE11: al pasar a segundo plano durante un descanso, el servidor
 * avisa cuando termina (iOS no permite avisos locales programados); al volver se cancela.
 * Solo el dispositivo dueño del temporizador lo programa (ADR-006).
 */
export function useBreakEndNotice(view: TimerView | undefined): void {
  const prefs = useNotificationPrefs();
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });
  const wanted = prefs?.enabled === true && prefs.breakEnd.enabled;

  useEffect(() => {
    if (!wanted) return;
    let scheduled: BreakEndCancel | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (scheduled) void cancelBreakEnd(scheduled).catch(() => undefined);
        scheduled = null;
        return;
      }
      const current = latest.current;
      const session = current?.session;
      if (
        !current?.isOwner ||
        !session ||
        (session.state !== 'break_short' && session.state !== 'break_long')
      ) {
        return;
      }
      const serverNow = Date.now() + current.offsetMs; // las marcas del temporizador son del servidor (SY7)
      const left = remainingMs(session, serverNow);
      if (left <= 0) return;
      scheduled = { timerSessionId: session.id, blockIndex: session.blockIndex };
      // Sin red no hay aviso: el descanso sigue igual y la pantalla lo muestra al volver.
      void scheduleBreakEnd({ ...scheduled, fireAt: serverNow + left }).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [wanted]);
}
