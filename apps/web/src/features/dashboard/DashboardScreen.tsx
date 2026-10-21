import type { StudyConfig } from '@estudio/shared';
import type { Proportion, WeeklyMetrics } from '@estudio/srs';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTodayPlan } from '@/features/study';
import { EmptyState } from '@/ui/EmptyState';
import { useWeeklyMetrics } from './use-weekly-metrics';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const link = `inline-flex min-h-11 items-center px-2 text-primary ${focus}`;
const MINUTE_MS = 60_000;

/**
 * Resumen semanal de §5, mostrado sin ansiedad (UX9): oculto con pocos datos, contra su
 * propia línea base, con rango y sin colores de alarma. Cada métrica se apaga en Ajustes.
 */
export function DashboardScreen() {
  const { t } = useTranslation();
  const view = useWeeklyMetrics();
  return (
    <>
      <header className="flex min-h-11 items-center justify-between gap-3">
        <Link className={`-ml-2 ${link}`} to="/">
          {t('dashboard.back')}
        </Link>
        <h1 className="m-0 text-body font-semibold">{t('dashboard.title')}</h1>
        <span className="min-w-11" />
      </header>
      {view.status === 'failed' ? (
        <EmptyState
          message={t('dashboard.failed')}
          action={
            <button type="button" className={link} onClick={view.retry}>
              {t('error.retry')}
            </button>
          }
        />
      ) : null}
      {view.status === 'ready' ? (
        <Summary metrics={view.metrics} config={view.config} timeZone={view.timeZone} />
      ) : null}
    </>
  );
}

function Summary({
  metrics,
  config,
  timeZone,
}: {
  readonly metrics: WeeklyMetrics;
  readonly config: StudyConfig;
  readonly timeZone: string;
}) {
  const { t } = useTranslation();
  const visible = config.metrics.visible;
  if (!metrics.enoughData) {
    return <EmptyState message={t('dashboard.fewData', { min: config.metrics.minReviewsToShow })} />;
  }
  if (
    ![
      visible.activeTime,
      visible.retention,
      visible.calibration,
      visible.load,
      visible.improveList,
      visible.sleep,
    ].some(Boolean)
  ) {
    return (
      <EmptyState
        message={t('dashboard.allHidden')}
        action={
          <Link className={link} to="/settings">
            {t('settings.title')}
          </Link>
        }
      />
    );
  }
  return (
    <>
      <p className="m-0 text-caption text-muted">{t('dashboard.intro')}</p>
      {visible.activeTime ? <ActiveTime metrics={metrics} config={config} /> : null}
      {visible.retention ? <Retention metrics={metrics} /> : null}
      {visible.calibration ? <CalibrationCard metrics={metrics} config={config} /> : null}
      {visible.load ? <Load metrics={metrics} timeZone={timeZone} /> : null}
      {visible.improveList ? <Improve /> : null}
      {visible.sleep ? <Sleep metrics={metrics} config={config} /> : null}
    </>
  );
}

function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1 rounded-(--radius-card) bg-surface p-5">
      <h2 id={id} className="m-0 text-caption font-normal text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function useFormat() {
  const { t, i18n } = useTranslation();
  const pct = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 });
  return {
    percent: (value: number) => pct.format(value),
    duration: (ms: number) => {
      const minutes = Math.round(ms / MINUTE_MS);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h === 0 ? t('dashboard.duration.m', { m }) : t('dashboard.duration.hm', { h, m });
    },
  };
}

/** R21: sin meta diaria ni comparación con nadie; solo sus semanas anteriores. */
function ActiveTime({ metrics, config }: { readonly metrics: WeeklyMetrics; readonly config: StudyConfig }) {
  const { t } = useTranslation();
  const { duration } = useFormat();
  const { weekMs, baseline } = metrics.activeTime;
  return (
    <Card title={t('dashboard.activeTime.title')}>
      <p className="m-0 text-title font-semibold">{duration(weekMs)}</p>
      <p className="m-0">
        {baseline
          ? t('dashboard.activeTime.baseline', {
              min: duration(baseline.minMs),
              max: duration(baseline.maxMs),
            })
          : t('dashboard.noBaseline')}
      </p>
      <p className="m-0 text-caption text-muted">
        {t('dashboard.activeTime.hint', { seconds: config.metrics.inactivityCutoffSec })}
      </p>
    </Card>
  );
}

/** §5: rango semanal frente al objetivo; olvidar algunas es lo esperado. */
function Retention({ metrics }: { readonly metrics: WeeklyMetrics }) {
  const { t } = useTranslation();
  const { percent } = useFormat();
  const { week, baseline, target } = metrics.retention;
  return (
    <Card title={t('dashboard.retention.title')}>
      {hasRate(week) ? (
        <>
          <p className="m-0 text-title font-semibold">
            {t('dashboard.retention.week', { rate: percent(week.rate), count: week.total })}
          </p>
          <p className="m-0">
            {t('dashboard.retention.range', {
              low: percent(week.low),
              high: percent(week.high),
              target: percent(target),
            })}
          </p>
        </>
      ) : (
        <p className="m-0">{t('dashboard.retention.none')}</p>
      )}
      <p className="m-0">
        {baseline && hasRate(baseline)
          ? t('dashboard.retention.baseline', { rate: percent(baseline.rate), count: baseline.total })
          : t('dashboard.noBaseline')}
      </p>
      <p className="m-0 text-caption text-muted">
        {t('dashboard.retention.expected', {
          target: percent(target),
          forget: Math.round((1 - target) * 100),
        })}
      </p>
    </Card>
  );
}

const hasRate = (
  p: Proportion,
): p is Proportion & { readonly rate: number; readonly low: number; readonly high: number } =>
  p.rate !== null && p.low !== null && p.high !== null;

/** §5: una frase semanal neutra, sin cifras que se lean como nota. */
function CalibrationCard({
  metrics,
  config,
}: {
  readonly metrics: WeeklyMetrics;
  readonly config: StudyConfig;
}) {
  const { t } = useTranslation();
  const c = metrics.calibration;
  return (
    <Card title={t('dashboard.calibration.title')}>
      {c ? (
        <>
          <p className="m-0">{t(`dashboard.calibration.${c.tendency}`)}</p>
          {c.resolution ? <p className="m-0">{t(`dashboard.calibration.${c.resolution}`)}</p> : null}
        </>
      ) : (
        <p className="m-0">
          {t(config.review.askConfidence ? 'dashboard.calibration.few' : 'dashboard.calibration.off', {
            min: config.metrics.calibrationMinSamples,
          })}
        </p>
      )}
    </Card>
  );
}

/** §5: "pendientes", sin rojo ni "atrasadas". */
function Load({ metrics, timeZone }: { readonly metrics: WeeklyMetrics; readonly timeZone: string }) {
  const { t, i18n } = useTranslation();
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone });
  return (
    <Card title={t('dashboard.load.title')}>
      <dl className="m-0 grid grid-cols-7 gap-1 pt-1 text-center">
        {metrics.load.map((day, i) => (
          <div key={day.day} className="flex flex-col">
            <dt className="text-caption text-muted">
              {i === 0 ? t('dashboard.load.today') : weekday.format(day.day)}
            </dt>
            <dd className="m-0 font-semibold tabular-nums">{day.count}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** §5: el sueño como contexto (opcional), contra sus semanas previas; sin metas ni rachas. */
function Sleep({ metrics, config }: { readonly metrics: WeeklyMetrics; readonly config: StudyConfig }) {
  const { t, i18n } = useTranslation();
  const decimal = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const { week, baseline, enoughData } = metrics.sleep;
  return (
    <Card title={t('dashboard.sleep.title')}>
      {enoughData && week.median !== null ? (
        <>
          <p className="m-0 text-title font-semibold">
            {t('dashboard.sleep.week', { median: decimal.format(week.median), count: week.nights })}
          </p>
          <p className="m-0">
            {baseline && baseline.median !== null
              ? t('dashboard.sleep.baseline', {
                  median: decimal.format(baseline.median),
                  count: baseline.nights,
                })
              : t('dashboard.noBaseline')}
          </p>
        </>
      ) : (
        <p className="m-0">{t('dashboard.sleep.few', { min: config.metrics.sleepMinNights })}</p>
      )}
      <p className="m-0 text-caption text-muted">{t('dashboard.sleep.hint')}</p>
    </Card>
  );
}

/** §5: lista accionable "para mejorar", no de fallos; se reformulan desde Hoy. */
function Improve() {
  const { t } = useTranslation();
  const snapshot = useTodayPlan();
  if (!snapshot) return null;
  const count = snapshot.toImprove.length;
  return (
    <Card title={t('dashboard.improve.title')}>
      <p className="m-0">{t('dashboard.improve.count', { count })}</p>
      {count > 0 ? (
        <Link className={`-ml-2 self-start ${link}`} to="/">
          {t('dashboard.improve.link')}
        </Link>
      ) : null}
    </Card>
  );
}
