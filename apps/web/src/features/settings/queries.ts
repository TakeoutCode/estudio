import {
  DAY_MS,
  type NotificationPrefs,
  type ProfileSettings,
  type StudyConfig,
  type UiSettings,
} from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readNotificationPrefs, readProfile, readStudyConfig, readUiSettings } from '@/db/settings';
import type { BreakUsageInput, LoadProjectionInput } from '@/workers/projection-api';

/** §5: bloques y descansos del temporizador para "Tus descansos"; srs elige las semanas. */
export const useBreakUsageInput = (): BreakUsageInput | undefined =>
  useLiveQuery(async () => {
    const now = Date.now();
    const [config, profile] = await Promise.all([readStudyConfig(db), readProfile(db)]);
    // Una semana de margen sobre la ventana de `baselineWeeks`; srs recorta por días locales.
    const since = now - (config.metrics.baselineWeeks + 1) * 7 * DAY_MS;
    const blocks = await db.timerBlockLogs.where('endedAt').aboveOrEqual(since).toArray();
    return { blocks, config, now, timeZone: profile.timeZone };
  }, []);

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

/** UI-UX UX5: el tema elegido (Sistema por defecto). */
export const useUiSettings = (): UiSettings | undefined => useLiveQuery(() => readUiSettings(db), []);

/** Zona horaria (AG6) y hora de dormir (P6). */
export const useProfile = (): ProfileSettings | undefined => useLiveQuery(() => readProfile(db), []);

/** NOTIFICATIONS §1: preferencias de avisos (apagados por defecto, NT8). */
export const useNotificationPrefs = (): NotificationPrefs | undefined =>
  useLiveQuery(() => readNotificationPrefs(db), []);
