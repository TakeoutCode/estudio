import type { ReviewLog, StudyConfig } from '@estudio/shared';
import { type CardState, type ReplayCard, replaySettingsKey } from '@estudio/srs';
import { projectCards } from './projection';
import { alive, type EstudioDb } from './schema';
import { readStudyConfig } from './settings';

/** En `meta`: `replaySettingsKey()` de la configuración con la que se armó `cardStates`. */
export const PROJECTION_SETTINGS_KEY = 'projectionSettings';

export type ReplayAll = (input: {
  readonly cards: readonly ReplayCard[];
  readonly logs: readonly ReviewLog[];
  readonly config: Pick<StudyConfig, 'fsrs' | 'exam'>;
}) => Promise<CardState[]>;

/**
 * ARC5 y FRONTEND FE4: si cambió algo que afecta a `replay()` (la retención de R2, por
 * ejemplo), reconstruye toda la proyección con `replayAll` (el worker). Devuelve `true` si
 * la reconstruyó.
 *
 * Mientras calcula el worker, ella puede responder o llegar un pull: al escribir, una tarjeta
 * cuyo número de repasos ya no coincide, o que se borró, se vuelve a proyectar aquí con
 * `projectCards`, en la misma transacción.
 */
export async function reprojectIfStale(database: EstudioDb, replayAll: ReplayAll): Promise<boolean> {
  const config = await readStudyConfig(database);
  const key = replaySettingsKey(config);
  if ((await database.meta.get(PROJECTION_SETTINGS_KEY))?.value === key) return false;

  const cards = (await alive(database.cards.toCollection()).toArray()).map((card) => ({
    cardId: card.id,
    createdAt: card.createdAt,
  }));
  const states = await replayAll({
    cards,
    logs: await database.reviewLogs.toArray(),
    config: { fsrs: config.fsrs, exam: config.exam },
  });

  await database.transaction(
    'rw',
    [database.cards, database.reviewLogs, database.cardStates, database.userSettings, database.meta],
    async () => {
      const ids = states.map((s) => s.cardId);
      const [live, current] = await Promise.all([
        database.cards.bulkGet(ids),
        database.cardStates.bulkGet(ids),
      ]);
      const changed: string[] = [];
      const fresh = states.filter((state, i) => {
        const moved = live[i]?.deletedAt !== null || (current[i] && current[i].reps !== state.reps);
        if (moved) changed.push(state.cardId);
        return !moved;
      });
      await database.cardStates.bulkPut(fresh);
      await projectCards(database, changed);
      // La clave de lo que calculó el worker: si la configuración cambió mientras tanto, la
      // siguiente revisión la ve distinta y vuelve a reconstruir.
      await database.meta.put({ key: PROJECTION_SETTINGS_KEY, value: key });
    },
  );
  return true;
}
