import {
  type GamificationConfig,
  GamificationConfigSchema,
  type NotificationPrefs,
  NotificationPrefsSchema,
  type ProfileSettings,
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
import {
  readGamificationConfig,
  readNotificationPrefs,
  readProfile,
  readStudyConfig,
  readUiSettings,
} from '@/db/settings';
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

/** UX10: la sección `gamification` (la respuesta del onboarding, la racha y las celebraciones). */
export function updateGamificationConfig(
  update: (current: GamificationConfig) => GamificationConfig,
  options: CommandOptions = {},
): Promise<GamificationConfig> {
  const database = options.database ?? defaultDb;
  return writeSection(
    'gamification',
    async () => GamificationConfigSchema.parse(update(await readGamificationConfig(database))),
    options,
  );
}

const hasStoredProfile = async (database: EstudioDb): Promise<boolean> =>
  (await database.userSettings.where('section').equals('profile').first())?.deletedAt === null;

/**
 * AGENTS AG6: el cron decide "hoy" y las horas silenciosas con su zona. Si nunca la guardó,
 * se guarda la de este dispositivo; si ya existe, no se toca.
 */
export async function ensureProfileTimeZone(timeZone: string, options: CommandOptions = {}): Promise<void> {
  const database = options.database ?? defaultDb;
  if (await hasStoredProfile(database)) return;
  await writeSection(
    'profile',
    async () => ProfileSettingsSchema.parse({ ...(await readProfile(database)), timeZone }),
    options,
  );
}

/**
 * La sección `profile` (P6: hora de dormir). Si nunca se guardó, parte de `timeZone`, la de
 * este dispositivo: si no, la zona por defecto quedaría guardada como suya y
 * `ensureProfileTimeZone` ya no la corregiría (AG6).
 */
export function updateProfile(
  update: (current: ProfileSettings) => ProfileSettings,
  timeZone: string,
  options: CommandOptions = {},
): Promise<ProfileSettings> {
  const database = options.database ?? defaultDb;
  return writeSection(
    'profile',
    async () => {
      const current = await readProfile(database);
      const base = (await hasStoredProfile(database)) ? current : { ...current, timeZone };
      return ProfileSettingsSchema.parse(update(base));
    },
    options,
  );
}

/**
 * P3: su respuesta a la propuesta de bajar las nuevas. Aceptarla cambia el tope (la app nunca lo
 * baja sola); en los dos casos se anota cuándo respondió, para no volver a proponerlo enseguida
 * (`fewerNewProposal`). Va en UserSettings para que el otro dispositivo tampoco lo repita.
 */
export async function answerFewerNewProposal(
  accepted: number | null,
  timeZone: string,
  options: CommandOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  if (accepted !== null) {
    await updateStudyConfig(
      (cfg) => ({ ...cfg, planner: { ...cfg.planner, newPerSessionMax: accepted } }),
      options,
    );
  }
  await updateProfile((p) => ({ ...p, fewerNewAnsweredAt: now }), timeZone, { ...options, now });
}

/** SY8: vuelve a enviar lo rechazado (p. ej. si faltaba algo que ya llegó). */
export async function retryRejected({ database = defaultDb }: CommandOptions = {}): Promise<number> {
  const count = await database.outbox.where('status').equals('rejected').modify({ status: 'pending' });
  if (count > 0) syncScheduler.now();
  return count;
}

/**
 * SY8: descarta un cambio rechazado, solo porque ella lo pide después del aviso. El cambio sigue
 * en este dispositivo, pero no llegará a los otros.
 */
export async function discardRejected(
  mutationId: string,
  { database = defaultDb }: CommandOptions = {},
): Promise<void> {
  await database.transaction('rw', database.outbox, async () => {
    if ((await database.outbox.get(mutationId))?.status === 'rejected')
      await database.outbox.delete(mutationId);
  });
}
