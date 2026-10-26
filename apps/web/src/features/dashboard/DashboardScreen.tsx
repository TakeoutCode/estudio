import type { StudyConfig } from '@estudio/shared';
import type { Proportion, WeeklyMetrics } from '@estudio/srs';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTodayPlan } from '@/features/study';
import { EmptyState } from '@/ui/EmptyState';
import { PageHeader } from '@/ui/PageHeader';
import { SourceLink } from '@/ui/SourceLink';
import { useWeeklyMetrics } from './use-weekly-metrics';
import { useMockSummaries } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const link = `inline-flex min-h-11 items-center px-2 font-bold text-primary ${focus}`;
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
      <PageHeader title={t('dashboard.title')} />
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
      visible.mockExams,
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
      {visible.mockExams ? <MockExams timeZone={timeZone} /> : null}
    </>
  );
}

function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-1 rounded-(--radius-card) bg-surface shadow-card p-5"
    >
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
      <p className="m-0 text-title font-extrabold">{duration(weekMs)}</p>
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
          <p className="m-0 text-title font-extrabold">
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
        })}{' '}
        <SourceLink source={21} />
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
          <p className="m-0 text-title font-extrabold">
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

/**
 * §5 (simulacros): el último de cada examen, por tema y con la tendencia frente al anterior;
 * "pocos datos" por tema (UX9) y la calibración como frase. Sin nota de aprobado (LD13).
 */
function MockExams({ timeZone }: { readonly timeZone: string }) {
  const { t, i18n } = useTranslation();
  const summaries = useMockSummaries();
  if (!summaries) return null;
  const date = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', timeZone });
  return (
    <Card title={t('dashboard.mocks.title')}>
      {summaries.items.length === 0 ? <p className="m-0">{t('dashboard.mocks.none')}</p> : null}
      {summaries.items.map(({ exam, takenAt, result }) => (
        <div
          key={exam.id}
          className="flex flex-col gap-1 border-t-2 border-dashed border-line pt-2 first-of-type:border-0 first-of-type:pt-0"
        >
          <p className="m-0 font-bold wrap-break-word">
            {t('dashboard.mocks.exam', { title: exam.title, date: date.format(takenAt) })}
          </p>
          <p className="m-0">{t('mock.total', { correct: result.correct, count: result.graded })}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {result.topics.map((topic) => (
              <li key={topic.topicId ?? 'none'} className="flex flex-col">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 wrap-break-word">
                    {(topic.topicId && summaries.topics.get(topic.topicId)) ?? t('notes.noTopic')}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {t('mock.topicScore', { correct: topic.correct, count: topic.graded })}
                  </span>
                </span>
                {topic.fewData || topic.previous || topic.calibration ? (
                  <span className="text-caption text-muted">
                    {[
                      topic.fewData ? t('mock.fewData') : null,
                      topic.previous
                        ? t('mock.before', { correct: topic.previous.correct, count: topic.previous.graded })
                        : null,
                      topic.calibration ? t(`mock.topicCalibration.${topic.calibration}`) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {result.calibration ? (
            <p className="m-0 text-caption">{t(`mock.calibration.${result.calibration.tendency}`)}</p>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
