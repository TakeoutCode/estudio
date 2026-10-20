import { createScheduler, newCardState, replay } from '@estudio/srs';
import type { EstudioDb } from './schema';
import { readStudyConfig } from './settings';

/**
 * ARC5: reconstruye `cardStates` de las tarjetas indicadas reproduciendo su ReviewLog, así
 * dos dispositivos llegan al mismo estado sin importar el orden de llegada. Una tarjeta
 * borrada o desconocida sale de la proyección (SYNC §6).
 *
 * Llamar dentro de una transacción `rw` con `cards`, `reviewLogs`, `cardStates` y
 * `userSettings`. Solo las afectadas: el `replay()` completo va al worker (FRONTEND FE4).
 */
export async function projectCards(database: EstudioDb, cardIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return;
  const config = await readStudyConfig(database);
  const scheduler = createScheduler(config.fsrs);
  for (const id of ids) {
    const card = await database.cards.get(id);
    if (card?.deletedAt !== null) {
      await database.cardStates.delete(id);
      continue;
    }
    const logs = await database.reviewLogs.where('cardId').equals(id).toArray();
    await database.cardStates.put(replay(scheduler, newCardState(id, card.createdAt), logs, config.exam));
  }
}
