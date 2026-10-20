import type { ReviewLog, StudyConfig } from '@estudio/shared';
import { type CardState, createScheduler, newCardState, replay } from './scheduler.js';

// Replay de muchas tarjetas a la vez (ARCHITECTURE ARC5, FRONTEND FE4): tras cambiar la
// retención objetivo toda la proyección se reconstruye.

export interface ReplayCard {
  readonly cardId: string;
  readonly createdAt: number;
}

type ReplaySettings = Pick<StudyConfig, 'fsrs' | 'exam'>;

/**
 * Lo que cambia el resultado de `replay()`. Si difiere del que se usó para la proyección
 * guardada, la proyección quedó vieja. `projectionDays` no entra: no cambia ningún estado.
 */
export const replaySettingsKey = ({ fsrs, exam }: ReplaySettings): string =>
  JSON.stringify([fsrs.requestRetention, fsrs.maximumIntervalDays, fsrs.enableFuzz, exam.affectsScheduling]);

/** Logs agrupados por tarjeta en una sola pasada. */
export function logsByCard(logs: readonly ReviewLog[]): Map<string, ReviewLog[]> {
  const byCard = new Map<string, ReviewLog[]>();
  for (const log of logs) {
    const list = byCard.get(log.cardId);
    if (list) list.push(log);
    else byCard.set(log.cardId, [log]);
  }
  return byCard;
}

/** ARC5 y FE4: estado de cada tarjeta reproduciendo su log con la configuración dada. */
export function replayCards(
  cards: readonly ReplayCard[],
  logs: readonly ReviewLog[],
  config: ReplaySettings,
): CardState[] {
  const scheduler = createScheduler(config.fsrs);
  const byCard = logsByCard(logs);
  return cards.map((card) =>
    replay(scheduler, newCardState(card.cardId, card.createdAt), byCard.get(card.cardId) ?? [], config.exam),
  );
}
