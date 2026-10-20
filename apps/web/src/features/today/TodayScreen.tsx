import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type PlanSnapshot, useTodayPlan } from '@/features/study';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';

const primary =
  'inline-flex min-h-11 items-center justify-center rounded-(--radius-card) bg-primary px-4 text-primary-contrast focus-visible:outline-2 focus-visible:outline-primary';
const secondary = 'inline-flex min-h-11 items-center px-4 text-primary';

/** Pantalla inicial: lo pendiente de hoy, sin metas ni lenguaje de atraso (§5, UX7). */
export function TodayScreen() {
  const { t } = useTranslation();
  const snapshot = useTodayPlan();
  const addCard = (
    <Link className={secondary} to="/notes/new">
      {t('today.addCard')}
    </Link>
  );
  return (
    <>
      <h1 className="m-0 text-title font-semibold">{t('today.title')}</h1>
      {snapshot ? <Summary snapshot={snapshot} addCard={addCard} /> : null}
    </>
  );
}

function Summary({
  snapshot,
  addCard,
}: {
  readonly snapshot: PlanSnapshot;
  readonly addCard: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { plan, toImprove } = snapshot;
  const news = plan.queue.filter((q) => q.kind === 'new').length;
  const nothing = plan.queue.length === 0;
  return (
    <>
      {nothing ? (
        <EmptyState message={t('today.empty')} action={addCard} />
      ) : (
        <section className="flex flex-col gap-3 rounded-(--radius-card) bg-surface p-5">
          <p className="m-0 text-card">{t('today.pending', { count: plan.due })}</p>
          {news > 0 ? <p className="m-0 text-muted">{t('today.newCards', { count: news })}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Link className={primary} to="/study">
              {t('today.start')}
            </Link>
            {addCard}
          </div>
        </section>
      )}
      {plan.backlogSpreadDays ? (
        <Banner>{t('study.notice.spread', { days: plan.backlogSpreadDays })}</Banner>
      ) : null}
      {toImprove.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="today-improve">
          <h2 id="today-improve" className="m-0 text-body font-semibold">
            {t('today.improve.title')}
          </h2>
          <p className="m-0 text-caption text-muted">{t('today.improve.hint')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {toImprove.map((item) => (
              <li
                key={item.noteId}
                className="flex items-center justify-between gap-3 rounded-(--radius-card) bg-surface px-4 py-2"
              >
                <span className="line-clamp-2">{item.prompt}</span>
                <Link className={secondary} to={`/notes/${item.noteId}`}>
                  {t('today.improve.edit')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
