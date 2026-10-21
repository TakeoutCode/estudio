import {
  type GamificationConfig,
  GamificationConfigSchema,
  type NotificationPrefs,
  NotificationPrefsSchema,
  type ProfileSettings,
  ProfileSettingsSchema,
  type SettingsSection,
  type StudyConfig,
  StudyConfigSchema,
  type UiSettings,
  UiSettingsSchema,
} from '@estudio/shared';
import type { EstudioDb } from './schema';

// ARCHITECTURE ARC9 y AGENTS AG2: la configuración se vuelve a parsear al leerla. Así una
// fila guardada antes de que existiera una clave nueva recibe su valor inicial.

async function sectionData(database: EstudioDb, section: SettingsSection): Promise<unknown> {
  const row = await database.userSettings.where('section').equals(section).first();
  return row?.deletedAt === null ? row.data : {};
}

export async function readStudyConfig(database: EstudioDb): Promise<StudyConfig> {
  return StudyConfigSchema.parse(await sectionData(database, 'study'));
}

export async function readProfile(database: EstudioDb): Promise<ProfileSettings> {
  return ProfileSettingsSchema.parse(await sectionData(database, 'profile'));
}

export async function readNotificationPrefs(database: EstudioDb): Promise<NotificationPrefs> {
  return NotificationPrefsSchema.parse(await sectionData(database, 'notifications'));
}

export async function readUiSettings(database: EstudioDb): Promise<UiSettings> {
  return UiSettingsSchema.parse(await sectionData(database, 'ui'));
}

/** UX10: `enabled` es null hasta que ella responda; cuenta como apagada. */
export async function readGamificationConfig(database: EstudioDb): Promise<GamificationConfig> {
  return GamificationConfigSchema.parse(await sectionData(database, 'gamification'));
}
