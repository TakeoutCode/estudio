import type { BackoffAnswer } from '@estudio/shared';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { updateNotificationPrefs, useNotificationPrefs } from '@/features/settings';
import { answerBackoff, disableOnThisDevice, fetchNotificationState, refreshDeviceSubscription, reportOpened } from './commands';
import { useAtOpen } from './store';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const choice = `min-h-11 rounded-(--radius-card) border border-muted/40 px-2 text-primary disabled:opacity-60 ${focus}`;

/** El SW abre `/?aviso=<id>` (NOTIFICATIONS NT7). */
const AVISO_PARAM = 'aviso';

/**
 * NT7: al abrir la app reporta si llegó por un recordatorio, repone la suscripción de este
 * dispositivo y, si entró en modo reducido, pregunta una sola vez (nunca por push).
 */
export function NotificationsAtOpen() {
  const prefs = useNotificationPrefs();
  const [params, setParams] = useSearchParams();
  const question = useAtOpen((s) => s.question);

  useEffect(() => {
    if (!prefs || useAtOpen.getState().started) return;
    useAtOpen.getState().start();
    const aviso = params.get(AVISO_PARAM);
    const fromPush = aviso !== null && z.uuid().safeParse(aviso).success;
    if (aviso !== null) {
      setParams(
        (current) => {
          current.delete(AVISO_PARAM);
          return current;
        },
        { replace: true },
      );
    }
    void reportOpened(fromPush ? [aviso] : []).catch(() => undefined);
    if (!prefs.enabled) return;
    void refreshDeviceSubscription().catch(() => undefined);
    if (fromPush) return;
    fetchNotificationState()
      .then((state) => {
        useAtOpen.getState().setQuestion(state.askBackoffQuestion ? 'ask' : 'none');
      })
      .catch(() => undefined);
  }, [prefs, params, setParams]);

  if (!prefs?.enabled || question !== 'ask') return null;
  return <BackoffQuestion everyDays={prefs.backoffEveryDays} />;
}

/** "¿Quieres seguir recibiendo recordatorios? [Como antes] [Cada N días] [Desactivar]" (§3f). */
function BackoffQuestion({ everyDays }: { readonly everyDays: number }) {
  const { t } = useTranslation();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const answer = (picked: BackoffAnswer['choice']) => {
    setBusy(true);
    setFailed(false);
    const turnOff =
      picked === 'off'
        ? Promise.all([updateNotificationPrefs((p) => ({ ...p, enabled: false })), disableOnThisDevice()])
        : Promise.resolve();
    Promise.all([answerBackoff(picked), turnOff])
      .then(() => {
        useAtOpen.getState().setQuestion('none');
      })
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-(--radius-card) bg-surface p-4">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('notifications.backoff.question')}
      </h2>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className={choice}
          disabled={busy}
          onClick={() => {
            answer('as_before');
          }}
        >
          {t('notifications.backoff.asBefore')}
        </button>
        <button
          type="button"
          className={choice}
          disabled={busy}
          onClick={() => {
            answer('reduced');
          }}
        >
          {t('notifications.backoff.reduced', { count: everyDays })}
        </button>
        <button
          type="button"
          className={choice}
          disabled={busy}
          onClick={() => {
            answer('off');
          }}
        >
          {t('notifications.backoff.off')}
        </button>
      </div>
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('notifications.backoff.failed')}
        </p>
      ) : null}
    </section>
  );
}
