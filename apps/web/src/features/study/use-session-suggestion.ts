import type { PlannerConfig } from '@estudio/shared';
import { fatigueWarningDue, type StopReason, stopSuggestions } from '@estudio/srs';
import { useEffect, useRef } from 'react';
import { useSessionSignals } from './queries';
import { useStudy } from './store';

/** P6 durante la sesión; "cola completa" se dice en el resumen final. */
export type StopNow = Exclude<StopReason, 'queue_done'>;

export type Suggestion = { readonly kind: 'break' } | { readonly kind: 'stop'; readonly reason: StopNow };

/** Si hay varios motivos para parar se muestra uno a la vez, en este orden (UI). */
const STOP_ORDER: readonly StopNow[] = ['bedtime', 'fatigue', 'blocks_done'];

export interface SessionSuggestion {
  readonly suggestion: Suggestion | null;
  /** P6: pasó su hora de dormir; el resumen final lo menciona. */
  readonly bedtime: boolean;
  readonly planner: PlannerConfig | null;
  /** Ella siguió (botón o al responder): este aviso no se repite. */
  readonly dismiss: () => void;
}

/**
 * P5 y P6 en la sesión: sugerencias suaves que nunca bloquean. La lógica es de `srs`
 * (`fatigueWarningDue`, `stopSuggestions`); aquí solo se guarda qué vio ella (FE2).
 */
export function useSessionSuggestion({
  sessionId,
  startedAt,
  onBreak,
  queueDone,
  now,
}: {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly onBreak: boolean;
  readonly queueDone: boolean;
  readonly now: number;
}): SessionSuggestion {
  const signals = useSessionSignals(sessionId, startedAt);
  const fatigue = useStudy((s) => s.fatigue);
  const dismissedStops = useStudy((s) => s.dismissedStops);
  const warnFatigue = useStudy((s) => s.warnFatigue);
  const dismissFatigue = useStudy((s) => s.dismissFatigue);
  const rested = useStudy((s) => s.rested);
  const dismissStop = useStudy((s) => s.dismissStop);

  // P5: se revisa con cada respuesta; durante el descanso no hay nada que sugerir.
  useEffect(() => {
    if (!signals || onBreak) return;
    if (fatigueWarningDue(signals.logs, useStudy.getState().fatigue.since, signals.planner)) {
      warnFatigue(signals.logs.length);
    }
  }, [signals, onBreak, warnFatigue]);

  // Un descanso corta la serie de avisos seguidos (P6).
  const answers = useRef(0);
  useEffect(() => {
    if (signals) answers.current = signals.logs.length;
  });
  useEffect(() => {
    if (onBreak) rested(answers.current);
  }, [onBreak, rested]);

  const stops = signals
    ? stopSuggestions({
        queueDone,
        blocks: signals.blocks,
        fatigueWarningsInRow: fatigue.inRow,
        now,
        timeZone: signals.profile.timeZone,
        bedtime: signals.profile.bedtime,
        quietHours: signals.quietHours,
        cfg: signals.planner,
      })
    : [];
  const stop = STOP_ORDER.find((reason) => stops.includes(reason) && !dismissedStops.includes(reason));
  const suggestion: Suggestion | null = stop
    ? { kind: 'stop', reason: stop }
    : fatigue.showing
      ? { kind: 'break' }
      : null;

  return {
    suggestion,
    bedtime: stops.includes('bedtime'),
    planner: signals?.planner ?? null,
    dismiss: () => {
      if (stop) dismissStop(stop);
      dismissFatigue();
    },
  };
}
