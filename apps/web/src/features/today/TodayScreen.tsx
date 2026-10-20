import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useExamsOverview } from '@/features/exams';
import { NotificationsAtOpen } from '@/features/notifications';
import { type PlanSnapshot, useTodayPlan } from '@/features/study';
import { ActionBar } from '@/ui/ActionBar';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast ${focus}`;
const secondary = `inline-flex min-h-11 w-full items-center justify-center rounded-(--radius-card) px-4 text-primary ${focus}`;

/**
 * Pantalla inicial: lo pendiente de hoy, sin metas ni lenguaje de atraso (§5, UX7). Mobile
 * first (UX2): la acción principal abajo, al alcance del pulgar.
 */
export function TodayScreen() {
  const { t } = useTranslation();
  const snapshot = useTodayPlan();
  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-title font-semibold">{t('today.title')}</h1>
        <nav className="-mr-2 flex gap-1">
          <Link className={`inline-flex min-h-11 items-center px-2 text-primary ${focus}`} to="/exams">
            {t('exams.title')}
          </Link>
          <Link className={`inline-flex min-h-11 items-center px-2 text-primary ${focus}`} to="/dashboard">
            {t('dashboard.title')}
          </Link>
          <Link className={`inline-flex min-h-11 items-center px-2 text-primary ${focus}`} to="/settings">
            {t('settings.title')}
          </Link>
        </nav>
      </header>
      <NotificationsAtOpen />
      {snapshot ? <Summary snapshot={snapshot} /> : null}
    </>
  );
}

function Summary({ snapshot }: { readonly snapshot: PlanSnapshot }) {
  const { t } = useTranslation();
  const { plan, toImprove } = snapshot;
  const news = plan.queue.filter((q) => q.kind === 'new').length;
  const nothing = plan.queue.length === 0;
  return (
    <>
      {nothing ? (
        <EmptyState message={t('today.empty')} />
      ) : (
        <section className="flex flex-col gap-1 rounded-(--radius-card) bg-surface p-5">
          <p className="m-0 text-card">{t('today.pending', { count: plan.due })}</p>
          {news > 0 ? <p className="m-0 text-muted">{t('today.newCards', { count: news })}</p> : null}
        </section>
      )}
      {plan.backlogSpreadDays ? (
        <Banner>{t('study.notice.spread', { days: plan.backlogSpreadDays })}</Banner>
      ) : null}
      <FinalReviewOffers />
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
                className="flex items-center justify-between gap-3 rounded-(--radius-card) bg-surface py-1 pr-1 pl-4"
              >
                <span className="line-clamp-2">{item.prompt}</span>
                <Link
                  className={`inline-flex min-h-11 shrink-0 items-center px-3 text-primary ${focus}`}
                  to={`/notes/${item.noteId}`}
                >
                  {t('today.improve.edit')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ActionBar>
        {nothing ? null : (
          <Link className={primary} to="/study">
            {t('today.start')}
          </Link>
        )}
        <Link className={nothing ? primary : secondary} to="/notes/new">
          {t('today.addCard')}
        </Link>
      </ActionBar>
    </>
  );
}

/** LD12: en los últimos días antes de un examen, la vuelta de repaso previa. */
function FinalReviewOffers() {
  const { t } = useTranslation();
  const overview = useExamsOverview();
  if (!overview) return null;
  const offers = overview.exams.flatMap((exam) => {
    const count = overview.finalReviews.get(exam.id) ?? 0;
    return count > 0 ? [{ exam, count }] : [];
  });
  return (
    <>
      {offers.map(({ exam, count }) => (
        <Banner
          key={exam.id}
          action={
            <Link
              className={`inline-flex min-h-11 shrink-0 items-center px-2 text-primary ${focus}`}
              to={`/study?examen=${exam.id}`}
            >
              {t('today.finalReviewStart')}
            </Link>
          }
        >
          {t('today.finalReview', { exam: exam.title, count })}
        </Banner>
      ))}
    </>
  );
}
