import { describe, expect, it } from 'vitest';
import { NotificationKindSchema, NotificationPrefsSchema, REMINDER_KINDS } from './notification-prefs.js';

describe('NotificationPrefs (STUDY-METHODS §3, NOTIFICATIONS §1)', () => {
  const prefs = NotificationPrefsSchema.parse({});

  it('valores iniciales de §3', () => {
    expect(prefs).toMatchObject({
      enabled: false,
      maxRemindersPerDay: 2,
      quietHours: { start: '22:00', end: '07:00' },
      dailyReminderTime: null,
      minDueForReminder: 10,
      ignoredStreakForBackoff: 3,
      backoffEveryDays: 3,
      examSoonDaysBefore: [7, 1],
    });
  });

  it('§3d: no permite más de 2 recordatorios al día', () => {
    expect(NotificationPrefsSchema.safeParse({ maxRemindersPerDay: 3 }).success).toBe(false);
  });

  it.each([
    ['21:59', true],
    ['22:00', false],
    ['03:00', false],
    ['06:59', false],
    ['07:00', true],
  ])('NT3: recordatorio a las %s permitido = %s (horas silenciosas 22:00-07:00)', (time, ok) => {
    expect(NotificationPrefsSchema.safeParse({ dailyReminderTime: time }).success).toBe(ok);
  });

  it('NT1: solo existen los 4 tipos y ninguno es de racha (R19)', () => {
    expect(NotificationKindSchema.options).toEqual([
      'daily_reminder',
      'exam_soon',
      'study_plan',
      'break_end',
    ]);
    expect(NotificationKindSchema.options.some((k) => /streak|racha/i.test(k))).toBe(false);
  });

  it('§3g: el fin de descanso no es un recordatorio', () => {
    expect(REMINDER_KINDS).not.toContain('break_end');
  });
});
