import { localDateOf, type SleepLog } from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EstudioDb } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';

export interface SleepToday {
  /** §5: solo si ella lo activó en Ajustes (apagado por defecto). */
  readonly enabled: boolean;
  /** La noche que terminó hoy, si ya la anotó. */
  readonly today: SleepLog | null;
}

export async function readSleepToday(database: EstudioDb, now: number): Promise<SleepToday> {
  const [config, profile] = await Promise.all([readStudyConfig(database), readProfile(database)]);
  if (!config.metrics.visible.sleep) return { enabled: false, today: null };
  const date = localDateOf(now, profile.timeZone);
  const today = await database.sleepLogs.where('date').equals(date).first();
  return { enabled: true, today: today?.deletedAt === null ? today : null };
}

export const useSleepToday = (): SleepToday | undefined =>
  useLiveQuery(() => readSleepToday(db, Date.now()), []);
