import type { GamificationSummary } from '@estudio/srs';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { answerGamification } from './commands';
import { useGamificationConfig } from './queries';
import { useGamification } from './use-gamification';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const card = 'flex flex-col gap-3 rounded-(--radius-card) bg-surface p-4 shadow-card';
const quiet = `inline-flex min-h-11 items-center justify-center px-3 font-bold text-primary ${focus}`;

/**
 * UX10: en Hoy, la pregunta del onboarding mientras no responda y, si la activó, su nivel, sus
 * monedas y (opcional) su racha. Apagada no muestra nada.
 */
export function GamificationCard() {
  const config = useGamificationConfig();
  if (config?.enabled === null) return <GamificationQuestion />;
  if (config?.enabled !== true) return null;
  return <GamificationProgress />;
}

/** UX10: se pregunta una vez y queda apagada hasta que ella responda. Sin presión: dos botones iguales. */
function GamificationQuestion() {
  const { t } = useTranslation();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const answer = (enabled: boolean) => {
    setBusy(true);
    setFailed(false);
    answerGamification(enabled)
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const choice = `min-h-12 flex-1 rounded-(--radius-card) border-2 border-line-strong px-3 font-bold text-primary disabled:opacity-60 ${focus}`;
  return (
    <section aria-labelledby={id} className={card}>
      <h2 id={id} className="m-0 text-body font-extrabold">
        {t('gamification.question.title')}
      </h2>
      <p className="m-0 text-caption text-muted">{t('gamification.question.hint')}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className={choice}
          disabled={busy}
          onClick={() => {
            answer(true);
          }}
        >
          {t('gamification.question.yes')}
        </button>
        <button
          type="button"
          className={choice}
          disabled={busy}
          onClick={() => {
            answer(false);
          }}
        >
          {t('gamification.question.no')}
        </button>
      </div>
      {failed ? (
        <p role="alert" className="m-0 text-caption">
          {t('gamification.saveFailed')}
        </p>
      ) : null}
    </section>
  );
}

function GamificationProgress() {
  const view = useGamification();
  return view.status === 'ready' ? <Progress summary={view.summary} /> : null;
}

/** Nivel, XP del nivel, monedas y racha, con enlace a premios y logros. */
export function Progress({ summary }: { readonly summary: GamificationSummary }) {
  const { t } = useTranslation();
  const { level, coins, streak } = summary;
  return (
    <section data-gamification="" aria-label={t('gamification.title')} className={card}>
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-card font-extrabold">{t('gamification.level', { level: level.level })}</p>
        <p className="m-0 rounded-full bg-blush px-3 py-1 font-bold text-primary">
          {t('gamification.coins', { count: coins.balance })}
        </p>
      </div>
      <LevelBar level={level} />
      {streak ? (
        <p className="m-0 text-caption text-muted">
          {t(streak.state === 'paused' ? 'gamification.streakPaused' : 'gamification.streak', {
            count: streak.days,
          })}
        </p>
      ) : null}
      <Link to="/rewards" className={`${quiet} -ml-3 self-start`}>
        {t('gamification.open')}
      </Link>
    </section>
  );
}

export function LevelBar({ level }: { readonly level: GamificationSummary['level'] }) {
  const { t } = useTranslation();
  const percent = Math.round((level.xpInLevel / level.xpForLevel) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={t('gamification.levelProgress', { level: level.level })}
        aria-valuemin={0}
        aria-valuemax={level.xpForLevel}
        aria-valuenow={level.xpInLevel}
        className="h-3 overflow-hidden rounded-full bg-blush"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="m-0 text-caption text-muted tabular-nums">
        {t('gamification.xp', { xp: level.xpInLevel, total: level.xpForLevel })}
      </p>
    </div>
  );
}
