import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { answerFewerNewProposal } from '@/features/settings';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const accept = `inline-flex min-h-11 items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;
const later = `inline-flex min-h-11 items-center justify-center rounded-(--radius-card) px-4 text-primary disabled:opacity-60 ${focus}`;

/**
 * P3: si la retención baja persistió, propone la mitad de nuevas y revisar carga y sueño. Es
 * solo una propuesta: el tope cambia si ella la acepta (la app nunca lo baja sola), y con
 * "Ahora no" vuelve solo si la retención sigue baja otros días (`fewerNewProposal`).
 */
export function FewerNewOffer({
  proposed,
  current,
  days,
}: {
  readonly proposed: number;
  readonly current: number;
  /** Días seguidos con la retención baja (al menos `lowRetentionPersistDays`). */
  readonly days: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const answer = (accepted: number | null) => {
    setState('busy');
    answerFewerNewProposal(accepted, Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => {
      setState('failed');
    });
  };
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-5">
      <h2 id={id} className="m-0 text-body font-semibold">
        {t('today.fewerNew.title')}
      </h2>
      <p className="m-0">{t('today.fewerNew.body', { days, current, proposed })}</p>
      <p className="m-0 text-caption text-muted">
        {t('today.fewerNew.hint')}{' '}
        <Link className={`text-primary underline ${focus}`} to="/dashboard">
          {t('today.fewerNew.week')}
        </Link>
      </p>
      {state === 'failed' ? (
        <p role="alert" className="m-0 text-caption">
          {t('today.fewerNew.failed')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={accept}
          disabled={state === 'busy'}
          onClick={() => {
            answer(proposed);
          }}
        >
          {t('today.fewerNew.accept', { count: proposed })}
        </button>
        <button
          type="button"
          className={later}
          disabled={state === 'busy'}
          onClick={() => {
            answer(null);
          }}
        >
          {t('today.fewerNew.later')}
        </button>
      </div>
    </section>
  );
}
