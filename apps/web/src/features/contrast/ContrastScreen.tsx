import type { Proportion } from '@estudio/srs';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';
import { Loading } from '@/ui/Loading';
import { SourceLink } from '@/ui/SourceLink';
import { type ContrastGroupView, type ContrastOverview, useContrastOverview } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const textLink = `-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`;
const primaryLink = `inline-flex min-h-11 items-center justify-center rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy ${focus}`;

/**
 * R9, P4, LD10: los grupos de tarjetas que se confunden. Cuando ella acierta cada una al menos
 * una vez, sus repasos de un día van juntos en un set de contraste, solo en los grupos del brazo
 * `contrast`. Aquí se ve en qué brazo está cada grupo y cómo va la comparación.
 */
export function ContrastScreen() {
  const { t } = useTranslation();
  const overview = useContrastOverview();
  return (
    <>
      <header className="flex flex-col">
        <Link className={textLink} to="/decks">
          {t('contrast.backToDecks')}
        </Link>
        <h1 className="m-0 text-title font-extrabold">{t('contrast.title')}</h1>
      </header>
      <p className="m-0">{t('contrast.intro')}</p>
      <p className="m-0 text-caption text-muted">
        {/* STUDY-METHODS [7] y [8]: la evidencia sobre intercalar es contradictoria (R20). */}
        {t('contrast.evidence')} <SourceLink source={7} /> <SourceLink source={8} />
      </p>
      {overview === undefined ? (
        <Loading />
      ) : overview.groups.length === 0 ? (
        <EmptyState
          message={t('contrast.empty')}
          action={
            <Link className={primaryLink} to="/contrast/new">
              {t('contrast.new')}
            </Link>
          }
        />
      ) : (
        <>
          <Comparison overview={overview} />
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {overview.groups.map((view) => (
              <GroupRow key={view.group.id} view={view} />
            ))}
          </ul>
          <Link className={primaryLink} to="/contrast/new">
            {t('contrast.new')}
          </Link>
        </>
      )}
    </>
  );
}

/** LD10, UX9: solo con sus datos, con un rango y "pocos datos todavía" si no alcanza. */
function Comparison({ overview }: { readonly overview: ContrastOverview }) {
  const { t, i18n } = useTranslation();
  const { comparison, minReviewsPerArm, retentionMinDays } = overview;
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(value);
  const line = (key: 'contrast.armContrast' | 'contrast.armControl', p: Proportion) =>
    p.rate === null || p.low === null || p.high === null
      ? t(key, { count: p.total, value: '—', low: '—', high: '—' })
      : t(key, { count: p.total, value: percent(p.rate), low: percent(p.low), high: percent(p.high) });
  return (
    <section
      aria-labelledby="contrast-ab"
      className="flex flex-col gap-2 rounded-(--radius-card) bg-surface shadow-card p-4"
    >
      <h2 id="contrast-ab" className="m-0 text-body font-semibold">
        {t('contrast.comparison', { days: retentionMinDays })}
      </h2>
      {comparison.enough ? (
        <>
          <p className="m-0">{line('contrast.armContrast', comparison.contrast)}</p>
          <p className="m-0">{line('contrast.armControl', comparison.control)}</p>
          <p className="m-0 text-caption text-muted">{t('contrast.comparisonNote')}</p>
        </>
      ) : (
        <p className="m-0 text-muted">
          {t('contrast.fewData', {
            count: minReviewsPerArm,
            contrast: comparison.contrast.total,
            control: comparison.control.total,
          })}
        </p>
      )}
    </section>
  );
}

function GroupRow({ view }: { readonly view: ContrastGroupView }) {
  const { t } = useTranslation();
  const pending = view.members.filter((m) => !m.learned).length;
  const status =
    view.status === 'too_few'
      ? t('contrast.status.tooFew')
      : view.status === 'learning'
        ? t('contrast.status.learning', { count: pending })
        : t(view.group.abArm === 'contrast' ? 'contrast.status.readySets' : 'contrast.status.readyControl');
  return (
    <li>
      <Link
        className={`flex min-h-11 flex-col rounded-(--radius-card) bg-surface shadow-card px-4 py-3 ${focus}`}
        to={`/contrast/${view.group.id}`}
      >
        <span className="font-bold wrap-break-word">{view.group.name}</span>
        <span className="text-caption text-muted">
          {t('contrast.members', { count: view.members.length })} ·{' '}
          {t(view.group.abArm === 'contrast' ? 'contrast.arm.contrast' : 'contrast.arm.control')}
        </span>
        <span className="text-caption">{status}</span>
      </Link>
    </li>
  );
}
