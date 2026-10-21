import type { StudyConfig, TimerBlockLog } from '@estudio/shared';
import { weekWindows } from './windows.js';

// §5 "Uso de descansos" (tomados, omitidos, extendidos): sirve para comparar modos del
// temporizador con sus datos (§6). Se muestra solo en Ajustes.

export interface BreakUsage {
  /** Primer instante de la ventana: sus últimas `baselineWeeks` semanas. */
  readonly since: number;
  /** Descansos que llegaron a su tiempo. */
  readonly taken: number;
  /** Descansos que terminó antes de tiempo ("Seguir estudiando" o terminar el temporizador). */
  readonly cutShort: number;
  /** Bloques de enfoque con "+N min" (modo flexible). */
  readonly extended: number;
  /** Bloques de enfoque cerrados en la ventana (sin el tiempo declarado a mano). */
  readonly focusBlocks: number;
}

export function breakUsage(
  blocks: readonly Pick<TimerBlockLog, 'kind' | 'outcome' | 'extended' | 'endedAt'>[],
  config: Pick<StudyConfig, 'metrics'>,
  now: number,
  timeZone: string,
): BreakUsage {
  const windows = weekWindows(now, timeZone, config.metrics.baselineWeeks);
  const since = windows.at(-1)?.start ?? now;
  const until = windows[0]?.end ?? now;
  const inWindow = blocks.filter((b) => b.endedAt >= since && b.endedAt < until && b.outcome !== 'manual');
  const breaks = inWindow.filter((b) => b.kind !== 'focus');
  const focus = inWindow.filter((b) => b.kind === 'focus');
  return {
    since,
    taken: breaks.filter((b) => b.outcome === 'completed').length,
    cutShort: breaks.filter((b) => b.outcome === 'interrupted').length,
    extended: focus.filter((b) => b.extended).length,
    focusBlocks: focus.length,
  };
}
