import {
  type NotificationPrefs,
  NotificationPrefsSchema,
  ProfileSettingsSchema,
  type SettingsSection,
  settingsRowId,
  type StudyConfig,
  StudyConfigSchema,
  type UiSettings,
  UiSettingsSchema,
  UserSettingsSchema,
} from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { readNotificationPrefs, readProfile, readStudyConfig, readUiSettings } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { accountUserId } from '@/features/auth';
import { ensureProjection, syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/**
 * Escribe una sección de UserSettings (SYNC §1: una fila por sección, id determinista). La
 * sección se valida entera con su esquema antes de escribir (ARC9, AG4: los rangos mandan).
 */
async function writeSection<T>(
  section: SettingsSection,
  build: () => Promise<T>,
  { database = defaultDb, now = Date.now() }: CommandOptions,
): Promise<T> {
  const userId = await accountUserId(database);
  if (!userId) throw new Error('no_account');
  const saved = await database.transaction(
    'rw',
    [database.userSettings, database.outbox, database.meta],
    async () => {
      const data = await build();
      const hlc = await nextHlc(database, now);
      const row = UserSettingsSchema.parse({
        id: settingsRowId(userId, section),
        section,
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
  return saved;
}

/** Cambia la sección `study`: retención, temporizador, métricas… */
export async function updateStudyConfig(
  update: (current: StudyConfig) => StudyConfig,
  options: CommandOptions = {},
): Promise<StudyConfig> {
  const database = options.database ?? defaultDb;
  const saved = await writeSection(
    'study',
    async () => StudyConfigSchema.parse(update(await readStudyConfig(database))),
    options,
  );
  // R2, FE4: con otra retención, las fechas de todas las tarjetas se recalculan en el worker.
  void ensureProjection();
  return saved;
}

/** UI-UX UX5: la sección `ui` (tema). */
export function updateUiSettings(
  update: (current: UiSettings) => UiSettings,
  options: CommandOptions = {},
): Promise<UiSettings> {
  const database = options.database ?? defaultDb;
  return writeSection(
    'ui',
    async () => UiSettingsSchema.parse(update(await readUiSettings(database))),
    options,
  );
}

/** NOTIFICATIONS §1: la sección `notifications`; viaja a sus otros dispositivos y al cron. */
export function updateNotificationPrefs(
  update: (current: NotificationPrefs) => NotificationPrefs,
  options: CommandOptions = {},
): Promise<NotificationPrefs> {
  const database = options.database ?? defaultDb;
  return writeSection(
    'notifications',
    async () => NotificationPrefsSchema.parse(update(await readNotificationPrefs(database))),
    options,
  );
}

/**
 * AGENTS AG6: el cron decide "hoy" y las horas silenciosas con su zona. Si nunca la guardó,
 * se guarda la de este dispositivo; si ya existe, no se toca.
 */
export async function ensureProfileTimeZone(timeZone: string, options: CommandOptions = {}): Promise<void> {
  const database = options.database ?? defaultDb;
  const stored = await database.userSettings.where('section').equals('profile').first();
  if (stored?.deletedAt === null) return;
  await writeSection(
    'profile',
    async () => ProfileSettingsSchema.parse({ ...(await readProfile(database)), timeZone }),
    options,
  );
}
