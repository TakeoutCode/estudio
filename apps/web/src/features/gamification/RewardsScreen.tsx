import { REWARD_COST_MAX, type Reward, type RewardRedemption, RewardSchema } from '@estudio/shared';
import { BADGES, type GamificationSummary } from '@estudio/srs';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { NumberField } from '@/ui/NumberField';
import { deleteReward, redeemReward, saveReward } from './commands';
import { LevelBar } from './GamificationCard';
import { useGamificationConfig, useRedemptions, useRewards, useTimeZone } from './queries';
import { useGamification } from './use-gamification';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
const field = `min-h-11 w-full min-w-0 rounded-(--radius-card) border-2 border-line-strong bg-bg px-4 text-text placeholder:text-muted placeholder:italic ${focus}`;
const solid = `inline-flex min-h-11 shrink-0 items-center justify-center rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy disabled:opacity-60 ${focus}`;
const outline = `inline-flex min-h-11 shrink-0 items-center rounded-(--radius-card) border-2 border-primary px-3 font-bold text-primary disabled:border-line-strong disabled:text-muted disabled:opacity-60 ${focus}`;
const quiet = `inline-flex min-h-11 shrink-0 items-center px-3 text-primary ${focus}`;
const card = 'flex flex-col gap-3 rounded-(--radius-card) bg-surface p-4 shadow-card';

/** Solo una sugerencia para el campo vacío; el costo lo decide ella. */
const DEFAULT_COST = 50;
/** Los canjes más recientes; el resto sigue en el respaldo (QA7). */
const HISTORY_SHOWN = 20;

/**
 * UX10: premios que ella define y canjea con sus monedas, sus logros y lo canjeado. Diseño sin
 * evidencia (STUDY-METHODS §6): apagada no muestra nada de esto.
 */
export function RewardsScreen() {
  const { t } = useTranslation();
  const config = useGamificationConfig();
  return (
    <>
      <header className="flex flex-col">
        <Link className={textLink} to="/">
          {t('gamification.back')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">{t('gamification.title')}</h1>
      </header>
      {config === undefined ? null : config.enabled === true ? (
        <Enabled />
      ) : (
        <EmptyState
          message={t('gamification.off')}
          action={
            <Link className={quiet} to="/settings">
              {t('gamification.toSettings')}
            </Link>
          }
        />
      )}
    </>
  );
}

function Enabled() {
  const { t } = useTranslation();
  const view = useGamification();
  if (view.status === 'off' || view.status === 'loading') return null;
  if (view.status !== 'ready') {
    return <p className="m-0 text-muted">{t('gamification.unavailable')}</p>;
  }
  const { summary } = view;
  return (
    <div data-gamification="" className="flex flex-col gap-6">
      <section className={card} aria-label={t('gamification.balanceLabel')}>
        <p className="m-0 text-card font-extrabold">
          {t('gamification.balance', { count: summary.coins.balance })}
        </p>
        <LevelBar level={summary.level} />
        <p className="m-0 text-caption text-muted">{t('gamification.howXp')}</p>
      </section>
      <Rewards balance={summary.coins.balance} />
      <Badges badges={summary.badges} />
      <Redemptions />
    </div>
  );
}

function Rewards({ balance }: { readonly balance: number }) {
  const { t } = useTranslation();
  const id = useId();
  const rewards = useRewards();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="m-0 text-body font-extrabold">
        {t('gamification.rewards.title')}
      </h2>
      {rewards === undefined ? null : rewards.length === 0 ? (
        <p className="m-0 text-caption text-muted">{t('gamification.rewards.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rewards.map((reward) => (
            <RewardRow key={reward.id} reward={reward} balance={balance} />
          ))}
        </ul>
      )}
      <RewardForm />
    </section>
  );
}

type RowStatus = 'idle' | 'invalid' | 'failed' | 'notEnough' | 'redeemed';

function RewardRow({ reward, balance }: { readonly reward: Reward; readonly balance: number }) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<'view' | 'redeem' | 'edit' | 'delete'>('view');
  const [name, setName] = useState(reward.name);
  const [cost, setCost] = useState<number | null>(reward.cost);
  const [status, setStatus] = useState<RowStatus>('idle');
  const [busy, setBusy] = useState(false);
  const missing = reward.cost - balance;

  const run = (action: () => Promise<unknown>, done: RowStatus = 'idle') => {
    setBusy(true);
    action()
      .then(() => {
        setMode('view');
        setStatus(done);
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error && error.message === 'not_enough_coins' ? 'notEnough' : 'failed');
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (cost === null || !RewardSchema.shape.name.safeParse(name).success) {
      setStatus('invalid');
      return;
    }
    run(() => saveReward({ id: reward.id, name, cost }));
  };

  return (
    <li className={`${card} py-3`}>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-bold wrap-break-word">{reward.name}</span>
          <span className="text-caption text-muted">{t('gamification.coins', { count: reward.cost })}</span>
        </div>
        <button
          type="button"
          className={outline}
          disabled={missing > 0 || busy}
          aria-describedby={missing > 0 ? `${id}-missing` : undefined}
          aria-label={t('gamification.rewards.redeemNamed', { name: reward.name })}
          onClick={() => {
            setMode('redeem');
            setStatus('idle');
          }}
        >
          {t('gamification.rewards.redeem')}
        </button>
        <button
          type="button"
          className={quiet}
          aria-expanded={mode === 'edit' || mode === 'delete'}
          aria-label={t('gamification.rewards.editNamed', { name: reward.name })}
          onClick={() => {
            setMode(mode === 'edit' || mode === 'delete' ? 'view' : 'edit');
            setName(reward.name);
            setCost(reward.cost);
            setStatus('idle');
          }}
        >
          {t(
            mode === 'edit' || mode === 'delete' ? 'gamification.rewards.close' : 'gamification.rewards.edit',
          )}
        </button>
      </div>
      {missing > 0 ? (
        <p id={`${id}-missing`} className="m-0 text-caption text-muted">
          {t('gamification.rewards.missing', { count: missing })}
        </p>
      ) : null}
      {mode === 'redeem' ? (
        <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="flex flex-col gap-2">
          <p id={`${id}-confirm`} className="m-0">
            {t('gamification.rewards.confirmRedeem', { name: reward.name, count: reward.cost })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={solid}
              disabled={busy}
              onClick={() => {
                run(() => redeemReward(reward.id), 'redeemed');
              }}
            >
              {t('gamification.rewards.redeem')}
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                setMode('view');
              }}
            >
              {t('gamification.rewards.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {mode === 'edit' || mode === 'delete' ? (
        <div className="flex flex-col gap-3">
          <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
            <input
              className={field}
              value={name}
              maxLength={80}
              aria-label={t('gamification.rewards.name')}
              aria-invalid={status === 'invalid'}
              onChange={(event) => {
                setName(event.target.value);
                setStatus('idle');
              }}
            />
            <NumberField
              label={t('gamification.rewards.cost')}
              defaultValue={reward.cost}
              min={1}
              max={REWARD_COST_MAX}
              onChange={(value) => {
                setCost(value);
                setStatus('idle');
              }}
            />
            <button type="submit" className={`${solid} self-start`} disabled={busy}>
              {t('gamification.rewards.save')}
            </button>
          </form>
          {mode === 'delete' ? (
            <div role="alertdialog" aria-labelledby={`${id}-delete`} className="flex flex-col gap-2">
              <p id={`${id}-delete`} className="m-0">
                {t('gamification.rewards.confirmDelete', { name: reward.name })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`min-h-11 rounded-(--radius-card) border-2 border-danger px-4 font-bold text-danger disabled:opacity-60 ${focus}`}
                  disabled={busy}
                  onClick={() => {
                    run(() => deleteReward(reward.id));
                  }}
                >
                  {t('gamification.rewards.delete')}
                </button>
                <button
                  type="button"
                  className={quiet}
                  onClick={() => {
                    setMode('edit');
                  }}
                >
                  {t('gamification.rewards.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`-ml-3 inline-flex min-h-11 items-center self-start px-3 text-danger ${focus}`}
              onClick={() => {
                setMode('delete');
              }}
            >
              {t('gamification.rewards.delete')}
            </button>
          )}
        </div>
      ) : null}
      {status === 'idle' ? null : (
        <p role={status === 'redeemed' ? 'status' : 'alert'} className="m-0 text-caption">
          {t(`gamification.rewards.status.${status}`, { name: reward.name })}
        </p>
      )}
    </li>
  );
}

/** Agregar un premio: lo que ella quiera, con el costo que ella elija (UX10). */
function RewardForm() {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState('');
  const [cost, setCost] = useState<number | null>(DEFAULT_COST);
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState<'idle' | 'invalid' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (cost === null || !RewardSchema.shape.name.safeParse(name).success) {
      setStatus('invalid');
      return;
    }
    // El formulario se vacía al enviar, no al terminar: lo que escriba mientras se guarda no se borra.
    const draft = { name, cost };
    setBusy(true);
    setName('');
    setCost(DEFAULT_COST);
    setRound((n) => n + 1); // vuelve a montar el costo con su valor inicial
    setStatus('idle');
    saveReward(draft)
      .catch(() => {
        // Si no se guardó, vuelve su texto para no perderlo (UX3).
        setName(draft.name);
        setStatus('failed');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className={card} onSubmit={submit} noValidate aria-labelledby={id}>
      <h3 id={id} className="m-0 text-body font-bold">
        {t('gamification.rewards.add')}
      </h3>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">{t('gamification.rewards.name')}</span>
        <input
          className={field}
          value={name}
          maxLength={80}
          placeholder={t('gamification.rewards.placeholder')}
          aria-invalid={status === 'invalid'}
          onChange={(event) => {
            setName(event.target.value);
            setStatus('idle');
          }}
        />
      </label>
      <NumberField
        key={round}
        label={t('gamification.rewards.cost')}
        defaultValue={DEFAULT_COST}
        min={1}
        max={REWARD_COST_MAX}
        onChange={(value) => {
          setCost(value);
          setStatus('idle');
        }}
      />
      <button type="submit" className={`${solid} self-start`} disabled={busy}>
        {t('gamification.rewards.addButton')}
      </button>
      {status === 'idle' ? null : (
        <p role="alert" className="m-0 text-caption">
          {t(`gamification.rewards.status.${status}`)}
        </p>
      )}
    </form>
  );
}

/** UX10: logros por conductas propias, con la fecha de la primera vez. */
function Badges({ badges }: { readonly badges: GamificationSummary['badges'] }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const timeZone = useTimeZone();
  const earned = new Map(badges.map((b) => [b.id, b.earnedAt]));
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone });
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="m-0 text-body font-extrabold">
        {t('gamification.badges.title')}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {BADGES.map((badge) => {
          const at = earned.get(badge);
          return (
            <li
              key={badge}
              className={`flex flex-col rounded-(--radius-card) px-4 py-3 ${at === undefined ? 'border-2 border-dashed border-line-strong' : 'bg-blush'}`}
            >
              <span className={`font-bold ${at === undefined ? 'text-muted' : 'text-primary'}`}>
                {t(`gamification.badges.${badge}.name`)}
              </span>
              <span className="text-caption text-muted">
                {at === undefined
                  ? t(`gamification.badges.${badge}.how`)
                  : t('gamification.badges.earned', { date: date.format(at) })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Redemptions() {
  const { t, i18n } = useTranslation();
  const id = useId();
  const redemptions = useRedemptions();
  const timeZone = useTimeZone();
  if (!redemptions || redemptions.length === 0) return null;
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone });
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 text-body font-extrabold">
        {t('gamification.history.title')}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {redemptions.slice(0, HISTORY_SHOWN).map((r: RewardRedemption) => (
          <li key={r.id} className="flex items-baseline justify-between gap-3 text-caption">
            <span className="min-w-0 wrap-break-word">{r.name}</span>
            <span className="shrink-0 text-muted tabular-nums">
              {t('gamification.history.item', { count: r.cost, date: date.format(r.redeemedAt) })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
