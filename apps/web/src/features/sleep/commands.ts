import {
  localDateOf,
  type SleepLog,
  SleepLogSchema,
  sleepLogIdFor,
  type SleepQuality,
} from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { readProfile } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { accountUserId } from '@/features/auth';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/**
 * §5: un toque. Anota la noche que terminó hoy, en su día local (AG6); tocar otro número el
 * mismo día la corrige. El id sale de la cuenta y la fecha (SYNC §1): otro dispositivo que
 * anote la misma noche escribe la misma fila.
 */
export async function logSleep(
  quality: SleepQuality,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<SleepLog> {
  const userId = await accountUserId(database);
  if (!userId) throw new Error('no_account');
  const { timeZone } = await readProfile(database);
  const date = localDateOf(now, timeZone);
  const id = sleepLogIdFor(userId, date);
  const saved = await database.transaction(
    'rw',
    [database.sleepLogs, database.outbox, database.meta],
    async () => {
      const current = await database.sleepLogs.get(id);
      const hlc = await nextHlc(database, now);
      const row = SleepLogSchema.parse({
        id,
        date,
        quality,
        loggedAt: current?.deletedAt === null ? current.loggedAt : now,
        hlc,
        updatedAt: hlcWall(hlc),
        deletedAt: null,
      });
      await writeAndQueue(database, 'sleepLog', row, now);
      return row;
    },
  );
  syncScheduler.poke();
  return saved;
}
