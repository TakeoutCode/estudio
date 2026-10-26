import {
  isMinuteInRange,
  localDayNumber,
  localMinuteOfDay,
  type NotificationKind,
  type NotificationPrefs,
} from '@estudio/shared';

// Política de avisos de STUDY-METHODS §3 (a-g), R12 y R19; NOTIFICATIONS §3 y §6. Pura: el
// cron pasa `nowUtc`, la zona y los conteos (AGENTS AG3). §6: es diseño, no evidencia.

const HOUR_MS = 3_600_000;

/**
 * Por qué no se envió: se registra en cada supresión para revisar la política (§6).
 * `foreground`: volvió a la app antes del fin de descanso; `expired`: el poller llegó después
 * del TTL del aviso y ya no servía.
 */
export type SkipReason =
  | 'disabled'
  | 'quiet_hours'
  | 'daily_cap'
  | 'below_min_due'
  | 'backoff'
  | 'no_subscription'
  | 'foreground'
  | 'expired';

export type Decision = { readonly send: true } | { readonly send: false; readonly reason: SkipReason };

export interface BackoffState {
  /** §3f: modo reducido (un recordatorio cada `backoffEveryDays`). */
  readonly active: boolean;
  readonly lastReminderAt: number | null;
}

export interface DecideInput {
  readonly kind: NotificationKind;
  readonly nowUtc: number;
  readonly timeZone: string;
  readonly prefs: NotificationPrefs;
  /** Recordatorios ya enviados en su día local, por cuenta (no por dispositivo). */
  readonly remindersSentToday: number;
  /** `daily_reminder`: pendientes de hoy. */
  readonly dueCount: number;
  readonly backoff: BackoffState;
}

const SEND: Decision = { send: true };
const skip = (reason: SkipReason): Decision => ({ send: false, reason });

const kindEnabled = (kind: NotificationKind, prefs: NotificationPrefs): boolean => {
  switch (kind) {
    case 'break_end':
      return prefs.breakEnd.enabled;
    case 'study_plan':
      return prefs.studyPlan.enabled;
    case 'exam_soon':
      return prefs.examSoonDaysBefore.length > 0;
    case 'daily_reminder':
      return prefs.dailyReminderTime !== null;
  }
};

/**
 * NT2: decide un envío. Horas silenciosas siempre (§3c, R12); el fin de descanso no cuenta
 * para el tope ni para la reducción (§3g); los recordatorios, sí (§3d, §3f).
 */
export function decideNotification(i: DecideInput): Decision {
  if (!i.prefs.enabled || !kindEnabled(i.kind, i.prefs)) return skip('disabled');
  if (isMinuteInRange(localMinuteOfDay(i.nowUtc, i.timeZone), i.prefs.quietHours)) return skip('quiet_hours');
  if (i.kind === 'break_end') return SEND;
  if (i.remindersSentToday >= i.prefs.maxRemindersPerDay) return skip('daily_cap');
  if (i.backoff.active && !isBackoffDay(i)) return skip('backoff');
  if (i.kind === 'daily_reminder' && i.dueCount < i.prefs.minDueForReminder) return skip('below_min_due');
  return SEND;
}

/** §3f: en modo reducido, un recordatorio cada `backoffEveryDays` días locales. */
const isBackoffDay = (i: DecideInput): boolean =>
  i.backoff.lastReminderAt === null ||
  localDayNumber(i.nowUtc, i.timeZone) - localDayNumber(i.backoff.lastReminderAt, i.timeZone) >=
    i.prefs.backoffEveryDays;

export interface ReminderEvent {
  readonly sentAt: number;
  readonly openedAt: number | null;
}

/**
 * NT7 y §3f: un recordatorio sin abrir en `ignoredAfterHours`, o antes del siguiente, cuenta
 * como ignorado; abrir uno reinicia la serie. Con `ignoredStreakForBackoff` seguidos se
 * entra en modo reducido. `resetAt` ("Como antes") hace que la serie cuente desde ahí.
 */
export function backoffState(
  events: readonly ReminderEvent[],
  now: number,
  prefs: Pick<NotificationPrefs, 'ignoredAfterHours' | 'ignoredStreakForBackoff'>,
  resetAt: number | null,
): BackoffState & { readonly ignoredStreak: number } {
  const ordered = [...events].sort((a, b) => a.sentAt - b.sentAt);
  const counted = ordered.filter((e) => resetAt === null || e.sentAt > resetAt);
  let ignoredStreak = 0;
  counted.forEach((event, i) => {
    if (event.openedAt !== null) ignoredStreak = 0;
    else if (i < counted.length - 1 || now - event.sentAt >= prefs.ignoredAfterHours * HOUR_MS)
      ignoredStreak += 1;
  });
  return {
    ignoredStreak,
    active: ignoredStreak >= prefs.ignoredStreakForBackoff,
    lastReminderAt: ordered.at(-1)?.sentAt ?? null,
  };
}

/** NT5: los recordatorios que coinciden en un tick van juntos, en este orden. */
export const REMINDER_ORDER = ['exam_soon', 'study_plan', 'daily_reminder'] as const;
