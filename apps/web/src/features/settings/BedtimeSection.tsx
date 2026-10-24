import { type LocalTime, LocalTimeSchema, type MinuteRange } from '@estudio/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updateProfile } from './commands';
import { useNotificationPrefs, useProfile } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const timeInput = `min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-3 text-body tabular-nums ${focus}`;
const quiet = `-ml-3 inline-flex min-h-11 items-center self-start px-3 text-primary ${focus}`;

/**
 * P6: su hora de dormir. Desde esa hora hasta el fin de las horas silenciosas, la sesión
 * sugiere parar sin cortar nada; sin hora elegida se usa el inicio de las horas silenciosas
 * (LEARNING-DESIGN §6). Se guarda al cambiarla, como el tema, y dice la franja que resulta.
 */
export function BedtimeSection() {
  const profile = useProfile();
  const prefs = useNotificationPrefs();
  if (!profile || !prefs) return null;
  return <BedtimeField bedtime={profile.bedtime} quietHours={prefs.quietHours} />;
}

function BedtimeField({
  bedtime,
  quietHours,
}: {
  readonly bedtime: LocalTime | null;
  readonly quietHours: MinuteRange;
}) {
  const { t } = useTranslation();
  const id = useId();
  // Borrador local: la consulta en vivo llega un render tarde y devolvería el valor anterior.
  const [value, setValue] = useState(bedtime ?? '');
  const [failed, setFailed] = useState(false);
  const chosen = LocalTimeSchema.safeParse(value);
  // La franja va de la hora elegida al fin de las horas silenciosas: si coinciden, queda vacía.
  const hint = !chosen.success
    ? t('settings.bedtime.default', { start: quietHours.start, end: quietHours.end })
    : chosen.data === quietHours.end
      ? t('settings.bedtime.empty', { end: quietHours.end })
      : t('settings.bedtime.window', { start: chosen.data, end: quietHours.end });

  const save = (next: LocalTime | null) => {
    setFailed(false);
    const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    updateProfile((p) => ({ ...p, bedtime: next }), deviceTimeZone).catch(() => {
      setFailed(true);
    });
  };

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('settings.bedtime.title')}
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-time`}>{t('settings.bedtime.label')}</label>
        <input
          id={`${id}-time`}
          type="time"
          className={timeInput}
          value={value}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const next = LocalTimeSchema.safeParse(event.target.value);
            setValue(event.target.value);
            if (next.success) save(next.data);
            else if (event.target.value === '') save(null);
          }}
        />
      </div>
      <p id={`${id}-hint`} className="m-0 text-caption text-muted" aria-live="polite">
        {hint}
      </p>
      {chosen.success ? (
        <button
          type="button"
          className={quiet}
          onClick={() => {
            setValue('');
            save(null);
          }}
        >
          {t('settings.bedtime.clear')}
        </button>
      ) : null}
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('settings.saveFailed')}
        </p>
      ) : null}
    </section>
  );
}
