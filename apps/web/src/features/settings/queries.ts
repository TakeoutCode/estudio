import type { StudyConfig } from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';
import type { LoadProjectionInput } from '@/workers/projection-api';

/** La configuración guardada (ARC9: ya parseada, con los valores iniciales que falten). */
export const useStudyConfig = (): StudyConfig | undefined => useLiveQuery(() => readStudyConfig(db), []);

/**
 * R2 y LD8: lo que el worker necesita para proyectar la carga, leído una vez de Dexie
 * (ARC3). Solo tarjetas vivas de notas vivas, como la cola.
 */
export async function loadProjectionInput(
  database: EstudioDb = db,
  now: number = Date.now(),
): Promise<LoadProjectionInput> {
  const [config, profile] = await Promise.all([readStudyConfig(database), readProfile(database)]);
  const notes = new Set((await alive(database.notes.toCollection()).toArray()).map((n) => n.id));
  const cards = (await alive(database.cards.toCollection()).toArray())
    .filter((card) => notes.has(card.noteId))
    .map((card) => ({ cardId: card.id, createdAt: card.createdAt, lapseBaseline: card.lapseBaseline }));
  return { cards, logs: await database.reviewLogs.toArray(), config, now, timeZone: profile.timeZone };
}
