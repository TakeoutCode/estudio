import { z } from 'zod';
import { isMinuteInRange, LocalTimeSchema, minutesOfDay } from '../time.js';

// Política de avisos de STUDY-METHODS §3 (a-g), R12 y R19; detalle en NOTIFICATIONS.md.
// §6: el efecto de las notificaciones no se investigó; todo es apagable y configurable.

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const NotificationKindSchema = z.enum(['daily_reminder', 'exam_soon', 'study_plan', 'break_end']);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** Recordatorios: cuentan para el tope diario y para la reducción por ignorados (§3g). */
export const REMINDER_KINDS = [
  'daily_reminder',
  'exam_soon',
  'study_plan',
] as const satisfies readonly NotificationKind[];

export const QuietHoursSchema = z.object({
  start: LocalTimeSchema.default('22:00'), // R12, §3c
  end: LocalTimeSchema.default('07:00'), // R12, §3c
});

export const NotificationPrefsSchema = z
  .object({
    enabled: z.boolean().default(false), // NT8: el permiso se pide con un gesto de ella
    maxRemindersPerDay: int(0, 2).default(2), // §3d, §3g
    quietHours: QuietHoursSchema.prefault({}),
    dailyReminderTime: LocalTimeSchema.nullable().default(null), // §3b: la hora la elige ella
    minDueForReminder: int(1, 500).default(10), // §3b · hipótesis
    ignoredStreakForBackoff: int(1, 10).default(3), // §3f
    backoffEveryDays: int(1, 14).default(3), // §3f
    ignoredAfterHours: int(1, 48).default(12), // diseño · sin evidencia
    breakEnd: z.object({ enabled: z.boolean().default(true) }).prefault({}), // §3a
    examSoonDaysBefore: z
      .array(int(1, 60))
      .max(5)
      .default(() => [7, 1]), // §3g · diseño · sin evidencia
    studyPlan: z.object({ enabled: z.boolean().default(true) }).prefault({}), // §3g · diseño
  })
  .refine(
    (p) => p.dailyReminderTime === null || !isMinuteInRange(minutesOfDay(p.dailyReminderTime), p.quietHours),
    { path: ['dailyReminderTime'], message: 'reminder_in_quiet_hours' }, // NT3
  );

export type NotificationPrefs = z.output<typeof NotificationPrefsSchema>;
