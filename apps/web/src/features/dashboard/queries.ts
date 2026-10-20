import type { WeeklyMetricsInput } from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';

/** Pendientes de hoy y los días que siguen: una semana. */
const FORECAST_DAYS = 7;

/**
 * §5: lo que el worker necesita para el resumen semanal, leído de Dexie (ARC3). Solo
 * tarjetas vivas de notas vivas con estado guardado (las nuevas no son "pendientes").
 */
export async function loadMetricsInput(
  database: EstudioDb = db,
  now: number = Date.now(),
): Promise<WeeklyMetricsInput> {
  const [config, profile] = await Promise.all([readStudyConfig(database), readProfile(database)]);
  const notes = new Set((await alive(database.notes.toCollection()).toArray()).map((n) => n.id));
  const cards = (await alive(database.cards.toCollection()).toArray()).filter((c) => notes.has(c.noteId));
  const states = await database.cardStates.bulkGet(cards.map((c) => c.id));
  return {
    logs: await database.reviewLogs.toArray(),
    cards: cards.flatMap((card, i) => {
      const state = states[i];
      return state ? [{ state, lapseBaseline: card.lapseBaseline }] : [];
    }),
    config,
    now,
    timeZone: profile.timeZone,
    forecastDays: FORECAST_DAYS,
  };
}

/** Se vuelve a leer cuando cambian sus datos (p. ej. tras un pull). */
export const useMetricsInput = (): WeeklyMetricsInput | undefined =>
  useLiveQuery(() => loadMetricsInput(db), []);
