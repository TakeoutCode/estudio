import { RETENTION_RANGE, type StudyConfig, TIMER_RANGES } from '@estudio/shared';
import { type ReactNode, type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActionBar } from '@/ui/ActionBar';
import { NumberField } from '@/ui/NumberField';
import { Toggle } from '@/ui/Toggle';
import { BreakUsageSection } from './BreakUsageSection';
import { updateStudyConfig } from './commands';
import { useStudyConfig } from './queries';
import { ThemeSection } from './ThemeSection';
import { type ProjectedLoad, useProjectedLoad } from './use-projected-load';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast disabled:opacity-60 ${focus}`;
const step = `inline-flex size-11 shrink-0 items-center justify-center rounded-(--radius-card) border border-muted/40 text-title leading-none text-primary disabled:opacity-40 ${focus}`;

/** La retención se elige en puntos enteros (90 = 0.90) dentro del rango de R2. */
const toPoints = (retention: number) => Math.round(retention * 100);
const MIN_POINTS = toPoints(RETENTION_RANGE.min);
const MAX_POINTS = toPoints(RETENTION_RANGE.max);

const TIMER_KEYS = ['focusMin', 'shortBreakMin', 'longBreakMin', 'cyclesBeforeLong'] as const;
type TimerKey = (typeof TIMER_KEYS)[number];
type TimerDraft = Record<TimerKey, number | null>;

/** UX9: cada métrica de Tu semana se puede apagar por separado. */
const METRIC_KEYS = ['activeTime', 'retention', 'calibration', 'load', 'improveList'] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

/**
 * Ajustes de estudio: retención objetivo con su carga (R2, LD8), temporizador (R7), confianza
 * en repasos (R6) y métricas visibles (UX9). `children`: secciones de otras features (avisos),
 * que el router compone para que `settings` no dependa de ellas.
 */
export function SettingsScreen({ children }: { readonly children?: ReactNode }) {
  const config = useStudyConfig();
  return config ? <SettingsForm config={config}>{children}</SettingsForm> : null;
}

type Status = 'idle' | 'saved' | 'failed';

function SettingsForm({ config, children }: { readonly config: StudyConfig; readonly children?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const savedPoints = toPoints(config.fsrs.requestRetention);
  const [points, setPoints] = useState(savedPoints);
  const [timer, setTimer] = useState<TimerDraft>(() => ({
    focusMin: config.timer.focusMin,
    shortBreakMin: config.timer.shortBreakMin,
    longBreakMin: config.timer.longBreakMin,
    cyclesBeforeLong: config.timer.cyclesBeforeLong,
  }));
  const [askConfidence, setAskConfidence] = useState(config.review.askConfidence);
  const [visible, setVisible] = useState<Record<MetricKey, boolean>>(() => ({
    activeTime: config.metrics.visible.activeTime,
    retention: config.metrics.visible.retention,
    calibration: config.metrics.visible.calibration,
    load: config.metrics.visible.load,
    improveList: config.metrics.visible.improveList,
  }));
  const [status, setStatus] = useState<Status>('idle');
  const [busy, setBusy] = useState(false);
  const load = useProjectedLoad([savedPoints, points]);
  const percent = (p: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(p / 100);

  const invalid = TIMER_KEYS.some((key) => timer[key] === null);
  const dirty =
    points !== savedPoints ||
    TIMER_KEYS.some((key) => timer[key] !== config.timer[key]) ||
    askConfidence !== config.review.askConfidence ||
    METRIC_KEYS.some((key) => visible[key] !== config.metrics.visible[key]);
  const choose = (next: number) => {
    setPoints(Math.min(MAX_POINTS, Math.max(MIN_POINTS, next)));
    setStatus('idle');
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid || !dirty || busy) return;
    const chosen = (key: TimerKey) => timer[key] ?? config.timer[key];
    setBusy(true);
    // LD9: la retención solo cambia aquí, cuando ella guarda.
    updateStudyConfig((cfg) => ({
      ...cfg,
      fsrs: { ...cfg.fsrs, requestRetention: points / 100 },
      timer: {
        ...cfg.timer,
        focusMin: chosen('focusMin'),
        shortBreakMin: chosen('shortBreakMin'),
        longBreakMin: chosen('longBreakMin'),
        cyclesBeforeLong: chosen('cyclesBeforeLong'),
      },
      review: { ...cfg.review, askConfidence },
      metrics: { ...cfg.metrics, visible: { ...cfg.metrics.visible, ...visible } },
    }))
      .then(() => {
        setStatus('saved');
      })
      .catch(() => {
        setStatus('failed');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="flex flex-1 flex-col gap-6" onSubmit={submit} noValidate>
      <header className="flex min-h-11 items-center justify-between gap-3">
        <Link
          className={`-ml-2 inline-flex min-h-11 min-w-11 items-center px-2 text-primary ${focus}`}
          to="/"
        >
          {t('settings.back')}
        </Link>
        <h1 className="m-0 text-body font-semibold">{t('settings.title')}</h1>
        <span className="min-w-11" />
      </header>

      <section aria-labelledby={`${ids}-retention`} className="flex flex-col gap-3">
        <h2 id={`${ids}-retention`} className="m-0 text-body font-semibold">
          {t('settings.retention.title')}
        </h2>
        <p className="m-0 text-caption text-muted">{t('settings.retention.hint')}</p>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className={step}
            aria-label={t('settings.retention.decrease')}
            disabled={points <= MIN_POINTS}
            onClick={() => {
              choose(points - 1);
            }}
          >
            −
          </button>
          <output htmlFor={`${ids}-slider`} className="text-display font-semibold tabular-nums">
            {percent(points)}
          </output>
          <button
            type="button"
            className={step}
            aria-label={t('settings.retention.increase')}
            disabled={points >= MAX_POINTS}
            onClick={() => {
              choose(points + 1);
            }}
          >
            +
          </button>
        </div>
        <input
          id={`${ids}-slider`}
          type="range"
          className={`min-h-11 w-full accent-primary ${focus}`}
          min={MIN_POINTS}
          max={MAX_POINTS}
          step={1}
          value={points}
          aria-labelledby={`${ids}-retention`}
          aria-valuetext={percent(points)}
          onChange={(event) => {
            choose(Number(event.target.value));
          }}
        />
        <div className="-mt-2 flex justify-between text-caption text-muted" aria-hidden="true">
          <span>{percent(MIN_POINTS)}</span>
          <span>{percent(MAX_POINTS)}</span>
        </div>
        <LoadEstimate load={load} points={points} savedPoints={savedPoints} percent={percent} />
        {/* §5: con 90 %, olvidar 1 de cada 10 es lo previsto, y la app lo dice. */}
        <p className="m-0 text-caption text-muted">
          {t('settings.retention.expected', { value: percent(points), forget: 100 - points })}
        </p>
      </section>

      <section aria-labelledby={`${ids}-timer`} className="flex flex-col gap-3">
        <h2 id={`${ids}-timer`} className="m-0 text-body font-semibold">
          {t('settings.timer.title')}
        </h2>
        <p className="m-0 text-caption text-muted">{t('timer.rhythmHint')}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          {TIMER_KEYS.map((key) => (
            <NumberField
              key={key}
              label={t(`settings.timer.${key}`)}
              defaultValue={config.timer[key]}
              min={TIMER_RANGES[key].min}
              max={TIMER_RANGES[key].max}
              onChange={(value) => {
                setTimer((prev) => ({ ...prev, [key]: value }));
                setStatus('idle');
              }}
            />
          ))}
        </div>
      </section>

      <BreakUsageSection />

      {children}

      <ThemeSection />

      <section aria-labelledby={`${ids}-review`} className="flex flex-col gap-2">
        <h2 id={`${ids}-review`} className="m-0 text-body font-semibold">
          {t('settings.review.title')}
        </h2>
        <Toggle
          label={t('settings.review.askConfidence')}
          hint={t('settings.review.askConfidenceHint')}
          checked={askConfidence}
          onChange={(checked) => {
            setAskConfidence(checked);
            setStatus('idle');
          }}
        />
      </section>

      <section aria-labelledby={`${ids}-metrics`} className="flex flex-col gap-2">
        <h2 id={`${ids}-metrics`} className="m-0 text-body font-semibold">
          {t('settings.metrics.title')}
        </h2>
        <p className="m-0 text-caption text-muted">{t('settings.metrics.hint')}</p>
        {METRIC_KEYS.map((key) => (
          <Toggle
            key={key}
            label={t(`settings.metrics.${key}`)}
            checked={visible[key]}
            onChange={(checked) => {
              setVisible((prev) => ({ ...prev, [key]: checked }));
              setStatus('idle');
            }}
          />
        ))}
      </section>

      <ActionBar>
        {status === 'idle' ? null : (
          <p role="status" className="m-0 text-center text-caption">
            {t(status === 'saved' ? 'settings.saved' : 'settings.saveFailed')}
          </p>
        )}
        <button type="submit" className={primary} disabled={!dirty || invalid || busy}>
          {t('settings.save')}
        </button>
      </ActionBar>
    </form>
  );
}

/** R2: "más retención = más repasos al día", antes de guardar (LD8). */
function LoadEstimate({
  load,
  points,
  savedPoints,
  percent,
}: {
  readonly load: ProjectedLoad;
  readonly points: number;
  readonly savedPoints: number;
  readonly percent: (points: number) => string;
}) {
  const { t } = useTranslation();
  if (!load.available) return null;
  const box = 'flex flex-col gap-1 rounded-(--radius-card) bg-surface p-4';
  if (load.cards === 0) {
    return <p className={`m-0 text-muted ${box}`}>{t('settings.retention.loadEmpty')}</p>;
  }
  if (load.failed) {
    return (
      <div role="status" className={box}>
        <p className="m-0">{t('settings.retention.loadFailed')}</p>
        <button
          type="button"
          className={`-ml-3 inline-flex min-h-11 items-center self-start px-3 text-primary ${focus}`}
          onClick={load.retry}
        >
          {t('error.retry')}
        </button>
      </div>
    );
  }
  const candidate = load.perDay.get(points);
  const current = load.perDay.get(savedPoints);
  const ready = candidate !== undefined && current !== undefined;
  const changed = points !== savedPoints;
  return (
    <div className={box}>
      <div role="status">
        <p className="m-0 text-card">
          {ready
            ? t('settings.retention.load', { value: percent(points), count: Math.round(candidate) })
            : t('settings.retention.loading')}
        </p>
        {ready && changed ? (
          <p className="m-0">
            {t('settings.retention.loadNow', { value: percent(savedPoints), count: Math.round(current) })}
          </p>
        ) : null}
      </div>
      {load.days === null ? null : (
        <p className="m-0 text-caption text-muted">{t('settings.retention.loadHint', { days: load.days })}</p>
      )}
      {changed ? <p className="m-0 text-caption text-muted">{t('settings.retention.applies')}</p> : null}
    </div>
  );
}
