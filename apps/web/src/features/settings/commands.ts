import { settingsRowId, type StudyConfig, StudyConfigSchema, UserSettingsSchema } from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { accountUserId } from '@/features/auth';
import { ensureProjection, syncScheduler } from '@/sync';

/**
 * Cambia la sección `study` de UserSettings (SYNC §1: una fila por sección, id determinista).
 * Se valida entera con StudyConfigSchema antes de escribir (ARC9, AG4: los rangos mandan).
 */
export async function updateStudyConfig(
  update: (current: StudyConfig) => StudyConfig,
  { database = defaultDb, now = Date.now() }: { readonly database?: EstudioDb; readonly now?: number } = {},
): Promise<StudyConfig> {
  const userId = await accountUserId(database);
  if (!userId) throw new Error('no_account');
  const saved = await database.transaction(
    'rw',
    [database.userSettings, database.outbox, database.meta],
    async () => {
      const data = StudyConfigSchema.parse(update(await readStudyConfig(database)));
      const hlc = await nextHlc(database, now);
      const row = UserSettingsSchema.parse({
        id: settingsRowId(userId, 'study'),
        section: 'study',
        data,
        hlc,
        updatedAt: hlcWall(hlc),
        deletedAt: null,
      });
      await writeAndQueue(database, 'userSettings', row, now);
      return data;
    },
  );
  syncScheduler.poke();
  // R2, FE4: con otra retención, las fechas de todas las tarjetas se recalculan en el worker.
  void ensureProjection();
  return saved;
}
