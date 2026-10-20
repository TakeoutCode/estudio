import { z } from 'zod';
import { GamificationConfigSchema } from '../config/gamification-config.js';
import { NotificationPrefsSchema } from '../config/notification-prefs.js';
import { StudyConfigSchema } from '../config/study-config.js';
import { SyncMetaSchema } from '../sync/contracts.js';
import { LocalTimeSchema } from '../time.js';

// UserSettings: una fila LWW por sección (SYNC §1). Cada sección valida su `data` con su
// propio esquema, así una configuración inválida no entra ni por sync.

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('es', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const ProfileSettingsSchema = z.object({
  /** Zona horaria IANA de ella (AGENTS AG6): define "hoy" y las horas silenciosas. */
  timeZone: z.string().refine(isTimeZone, 'invalid_time_zone').default('America/Mexico_City'),
  /** P6: hora de dormir declarada; `null` usa el inicio de las horas silenciosas. */
  bedtime: LocalTimeSchema.nullable().default(null),
});

export type ProfileSettings = z.output<typeof ProfileSettingsSchema>;

export const UiSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'), // UI-UX UX5
});

const section = <S extends string, D extends z.ZodType>(name: S, data: D) =>
  SyncMetaSchema.extend({ section: z.literal(name), data }).strict();

export const UserSettingsSchema = z.discriminatedUnion('section', [
  section('profile', ProfileSettingsSchema),
  section('study', StudyConfigSchema),
  section('notifications', NotificationPrefsSchema),
  section('gamification', GamificationConfigSchema),
  section('ui', UiSettingsSchema),
]);
export type UserSettings = z.infer<typeof UserSettingsSchema>;
