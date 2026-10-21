import { SLEEP_QUALITIES, type SleepQuality } from '@estudio/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logSleep } from './commands';
import { useSleepToday } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const link = `inline-flex min-h-11 shrink-0 items-center px-3 text-primary ${focus}`;
const option = `inline-flex min-h-14 items-center justify-center rounded-(--radius-card) border text-card font-semibold tabular-nums ${focus}`;

/**
 * §5: "¿Cómo dormiste?" con un toque, solo si ella lo activó en Ajustes. Sin racha, sin aviso
 * y sin recordatorio: si no lo anota, no pasa nada. Ya anotado queda en una línea.
 */
export function SleepCheckIn() {
  const { t } = useTranslation();
  const id = useId();
  const state = useSleepToday();
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!state?.enabled) return null;
  const saved = state.today;

  if (saved && !editing) {
    return (
      <section
        aria-label={t('sleep.question')}
        className="flex items-center justify-between gap-3 rounded-(--radius-card) bg-surface py-1 pr-1 pl-4"
      >
        <p className="m-0">{t('sleep.saved', { quality: saved.quality })}</p>
        <button
          type="button"
          className={link}
          onClick={() => {
            setEditing(true);
          }}
        >
          {t('sleep.change')}
        </button>
      </section>
    );
  }

  const choose = (quality: SleepQuality) => {
    logSleep(quality)
      .then(() => {
        setEditing(false);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
      });
  };

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-4">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('sleep.question')}
      </h2>
      <div role="group" aria-labelledby={id} className="grid grid-cols-5 gap-2">
        {SLEEP_QUALITIES.map((quality) => {
          const chosen = saved?.quality === quality;
          return (
            <button
              key={quality}
              type="button"
              aria-pressed={chosen}
              aria-label={t('sleep.option', { quality, label: t(`sleep.quality.${quality}`) })}
              className={`${option} ${chosen ? 'border-primary bg-primary text-primary-contrast' : 'border-muted/40 text-primary'}`}
              onClick={() => {
                choose(quality);
              }}
            >
              {quality}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-caption text-muted" aria-hidden="true">
        <span>{t('sleep.quality.1')}</span>
        <span>{t('sleep.quality.5')}</span>
      </div>
      <p className="m-0 text-caption text-muted">{t('sleep.hint')}</p>
      {failed ? (
        <p role="status" className="m-0 text-caption">
          {t('sleep.failed')}
        </p>
      ) : null}
    </section>
  );
}
