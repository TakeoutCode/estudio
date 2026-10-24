import { type NotificationPrefs, NotificationPrefsSchema } from '@estudio/shared';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ensureProfileTimeZone, updateNotificationPrefs, useNotificationPrefs } from '@/features/settings';
import { env } from '@/lib/env';
import { useOnline } from '@/lib/use-online';
import { Toggle } from '@/ui/Toggle';
import { disableOnThisDevice, enableOnThisDevice } from './commands';
import { detectEnvironment, deviceSubscription, notificationPermission, pushSupport } from './push';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const primary = `inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-card) border-2 border-primary px-4 font-bold text-primary disabled:opacity-60 ${focus}`;
const quiet = `-ml-3 inline-flex min-h-11 items-center self-start px-3 text-primary disabled:opacity-60 ${focus}`;
const timeInput = `min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 bg-bg px-3 text-body tabular-nums ${focus}`;

/** Días antes del examen cuando ella activa ese aviso (NOTIFICATIONS §1). */
const EXAM_DAYS_DEFAULT = NotificationPrefsSchema.parse({}).examSoonDaysBefore;

type Device = 'checking' | 'subscribed' | 'none';
type Problem = 'denied' | 'failed' | 'saveFailed' | null;

/**
 * NOTIFICATIONS §1 y NT8: avisos apagados por defecto. El permiso se pide con un toque suyo,
 * después de explicar para qué sirve; en Safari de iPhone se explica cómo instalar la app.
 */
export function NotificationsSection() {
  const prefs = useNotificationPrefs();
  const { t } = useTranslation();
  const id = useId();
  if (!prefs) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('notifications.title')}
      </h2>
      <p className="m-0 text-caption text-muted">
        {t('notifications.hint', {
          start: prefs.quietHours.start,
          end: prefs.quietHours.end,
          count: prefs.maxRemindersPerDay,
        })}
      </p>
      <NotificationsBody prefs={prefs} />
    </section>
  );
}

function NotificationsBody({ prefs }: { readonly prefs: NotificationPrefs }) {
  const { t } = useTranslation();
  const online = useOnline();
  const [support] = useState(() => pushSupport(detectEnvironment(env.VITE_VAPID_PUBLIC_KEY)));
  const [device, setDevice] = useState<Device>('checking');
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (support !== 'ready') return;
    let live = true;
    void deviceSubscription()
      .then((subscription) => {
        if (live) setDevice(subscription ? 'subscribed' : 'none');
      })
      .catch(() => {
        if (live) setDevice('none');
      });
    return () => {
      live = false;
    };
  }, [support]);

  if (support === 'install')
    return (
      <p className="m-0 rounded-(--radius-card) bg-surface shadow-card p-4">{t('notifications.install')}</p>
    );
  if (support === 'unsupported') return <p className="m-0 text-muted">{t('notifications.unsupported')}</p>;
  if (device === 'checking') return null;

  const enable = () => {
    setBusy(true);
    setProblem(null);
    // Primero el permiso: tiene que pedirse dentro del toque (NT8).
    enableOnThisDevice()
      .then(async (result) => {
        if (result === 'denied') {
          setProblem('denied');
          return;
        }
        setDevice('subscribed');
        await ensureProfileTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        await updateNotificationPrefs((p) => ({ ...p, enabled: true }));
      })
      .catch(() => {
        setProblem('failed');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const active = prefs.enabled && device === 'subscribed';
  if (!active) {
    const blocked = notificationPermission() === 'denied' || problem === 'denied';
    return (
      <div className="flex flex-col gap-2">
        {prefs.enabled ? <p className="m-0">{t('notifications.otherDevice')}</p> : null}
        {blocked ? (
          <p role="status" className="m-0 rounded-(--radius-card) bg-surface shadow-card p-4">
            {t('notifications.denied')}
          </p>
        ) : (
          <button type="button" className={primary} disabled={busy || !online} onClick={enable}>
            {t(prefs.enabled ? 'notifications.enableHere' : 'notifications.enable')}
          </button>
        )}
        {!online && !blocked ? (
          <p className="m-0 text-caption text-muted">{t('notifications.needsConnection')}</p>
        ) : null}
        {problem === 'failed' ? (
          <p role="alert" className="m-0 text-caption">
            {t('notifications.failed')}
          </p>
        ) : null}
      </div>
    );
  }

  const save = (update: (current: NotificationPrefs) => NotificationPrefs) => {
    setProblem(null);
    updateNotificationPrefs(update).catch(() => {
      setProblem('saveFailed');
    });
  };
  const disable = () => {
    setBusy(true);
    setProblem(null);
    Promise.all([updateNotificationPrefs((p) => ({ ...p, enabled: false })), disableOnThisDevice()])
      .then(() => {
        setDevice('none');
      })
      .catch(() => {
        setProblem('saveFailed');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <PrefsFields prefs={prefs} onSave={save} />
      {problem === 'saveFailed' ? (
        <p role="alert" className="m-0 text-caption">
          {t('settings.saveFailed')}
        </p>
      ) : null}
      <button type="button" className={quiet} disabled={busy} onClick={disable}>
        {t('notifications.disable')}
      </button>
    </div>
  );
}

/** NT3: una hora dentro de las horas silenciosas no se guarda; se dice por qué. */
function PrefsFields({
  prefs,
  onSave,
}: {
  readonly prefs: NotificationPrefs;
  readonly onSave: (update: (current: NotificationPrefs) => NotificationPrefs) => void;
}) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const [daily, setDaily] = useState(prefs.dailyReminderTime ?? '');
  const [second, setSecond] = useState(prefs.secondReminderTime ?? '');
  const [quietStart, setQuietStart] = useState(prefs.quietHours.start);
  const [quietEnd, setQuietEnd] = useState(prefs.quietHours.end);

  const candidate = (next: { daily?: string; second?: string; start?: string; end?: string } = {}) => {
    const d = next.daily ?? daily;
    const s = next.second ?? second;
    return {
      ...prefs,
      dailyReminderTime: d === '' ? null : d,
      secondReminderTime: s === '' ? null : s,
      quietHours: { start: next.start ?? quietStart, end: next.end ?? quietEnd },
    };
  };
  // Cada hora dice su propio problema (horas silenciosas, o una segunda sin primera o repetida).
  const issues = NotificationPrefsSchema.safeParse(candidate()).error?.issues ?? [];
  const problemOf = (field: 'dailyReminderTime' | 'secondReminderTime') =>
    issues.find((issue) => issue.path[0] === field)?.message ?? null;
  const dailyProblem = problemOf('dailyReminderTime');
  const secondProblem = problemOf('secondReminderTime');
  const commit = (next: { daily?: string; second?: string; start?: string; end?: string }) => {
    const parsed = NotificationPrefsSchema.safeParse(candidate(next));
    if (parsed.success) {
      const { dailyReminderTime, secondReminderTime, quietHours } = parsed.data;
      onSave((p) => ({ ...p, dailyReminderTime, secondReminderTime, quietHours }));
    }
  };
  const days = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
    (prefs.examSoonDaysBefore.length > 0 ? prefs.examSoonDaysBefore : EXAM_DAYS_DEFAULT).map(String),
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-daily`}>{t('notifications.daily')}</label>
        <input
          id={`${ids}-daily`}
          type="time"
          className={`${timeInput} ${dailyProblem ? 'border-text' : 'border-line-strong'}`}
          value={daily}
          aria-invalid={dailyProblem !== null}
          aria-describedby={`${ids}-daily-hint`}
          onChange={(event) => {
            setDaily(event.target.value);
            commit({ daily: event.target.value });
          }}
        />
        <p id={`${ids}-daily-hint`} className="m-0 text-caption text-muted" aria-live="polite">
          {dailyProblem
            ? t('notifications.inQuietHours')
            : t('notifications.dailyHint', { count: prefs.minDueForReminder })}
        </p>
      </div>
      {/* §3d: una segunda hora opcional; solo con ella se llega al tope de 2 al día. */}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-second`}>{t('notifications.second')}</label>
        <input
          id={`${ids}-second`}
          type="time"
          className={`${timeInput} ${secondProblem ? 'border-text' : 'border-line-strong'}`}
          value={second}
          aria-invalid={secondProblem !== null}
          aria-describedby={`${ids}-second-hint`}
          onChange={(event) => {
            setSecond(event.target.value);
            commit({ second: event.target.value });
          }}
        />
        <p id={`${ids}-second-hint`} className="m-0 text-caption text-muted" aria-live="polite">
          {secondProblem === 'reminder_in_quiet_hours'
            ? t('notifications.inQuietHours')
            : secondProblem
              ? t('notifications.secondNeedsFirst')
              : t('notifications.secondHint', { count: prefs.maxRemindersPerDay })}
        </p>
      </div>
      <Toggle
        label={t('notifications.breakEnd')}
        hint={t('notifications.breakEndHint')}
        checked={prefs.breakEnd.enabled}
        onChange={(enabled) => {
          onSave((p) => ({ ...p, breakEnd: { enabled } }));
        }}
      />
      <Toggle
        label={t('notifications.examSoon')}
        hint={t('notifications.examSoonHint', { days })}
        checked={prefs.examSoonDaysBefore.length > 0}
        onChange={(on) => {
          onSave((p) => ({ ...p, examSoonDaysBefore: on ? EXAM_DAYS_DEFAULT : [] }));
        }}
      />
      <Toggle
        label={t('notifications.studyPlan')}
        hint={t('notifications.studyPlanHint')}
        checked={prefs.studyPlan.enabled}
        onChange={(enabled) => {
          onSave((p) => ({ ...p, studyPlan: { enabled } }));
        }}
      />
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="p-0">{t('notifications.quiet')}</legend>
        <p className="m-0 text-caption text-muted">{t('notifications.quietHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          {(['start', 'end'] as const).map((edge) => (
            <div key={edge} className="flex flex-col gap-1">
              <label htmlFor={`${ids}-${edge}`} className="text-caption text-muted">
                {t(edge === 'start' ? 'notifications.quietFrom' : 'notifications.quietTo')}
              </label>
              <input
                id={`${ids}-${edge}`}
                type="time"
                required
                className={`${timeInput} border-line-strong`}
                value={edge === 'start' ? quietStart : quietEnd}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '') return;
                  if (edge === 'start') setQuietStart(value);
                  else setQuietEnd(value);
                  commit({ [edge]: value });
                }}
              />
            </div>
          ))}
        </div>
      </fieldset>
    </>
  );
}
