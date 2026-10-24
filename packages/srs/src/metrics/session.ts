import { localDayBounds, type MetricsConfig, type ReviewLog } from '@estudio/shared';
import { activeTimeMs, type Proportion, realRetention } from './weekly.js';

// STUDY-METHODS §3: el resumen final de la sesión es opcional y neutral: tarjetas, tiempo activo
// y retención del día. Sin meta ni comparación (§5).

export interface SessionSummary {
  /** R21: tiempo entre las respuestas de esta sesión, con el tope de inactividad. */
  readonly activeMs: number;
  /** §5: repasos de tarjetas ya aprendidas de hoy (su día local), de esta sesión y de otras. */
  readonly todayRetention: Proportion;
}

export function sessionSummary(
  logs: readonly ReviewLog[],
  sessionId: string,
  now: number,
  timeZone: string,
  cfg: Pick<MetricsConfig, 'inactivityCutoffSec'>,
): SessionSummary {
  const today = localDayBounds(now, timeZone);
  return {
    activeMs: activeTimeMs(
      logs.filter((log) => log.sessionId === sessionId),
      cfg,
    ),
    todayRetention: realRetention(
      logs.filter((log) => log.reviewedAt >= today.start && log.reviewedAt < today.end),
    ),
  };
}
