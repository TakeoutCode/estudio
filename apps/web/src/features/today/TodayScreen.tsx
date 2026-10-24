import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { NotificationsAtOpen } from '@/features/notifications';
import { SleepCheckIn } from '@/features/sleep';
import { type PlanSnapshot, useTodayPlan } from '@/features/study';
import { ActionBar } from '@/ui/ActionBar';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';
import { FewerNewOffer } from './FewerNewOffer';

// FE9: la gamificación no entra en el JS inicial de Hoy; apagada, ni siquiera se muestra.
const GamificationCard = lazy(async () => ({
  default: (await import('@/features/gamification')).GamificationCard,
}));
// FE9: los exámenes tampoco; Hoy solo muestra su repaso previo (LD12).
const FinalReviewOffers = lazy(async () => ({
  default: (await import('@/features/exams')).FinalReviewOffers,
}));

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
      <SleepCheckIn />
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
      {/* Elegir un solo mazo para estudiar, editarlos o pausarlos; Empezar mezcla los activos (R9). */}
      <Link
        className={`-ml-2 inline-flex min-h-11 items-center self-start px-2 text-primary ${focus}`}
        to="/decks"
      >
        {snapshot.pausedDecks > 0
          ? t('today.decksPaused', { count: snapshot.pausedDecks })
          : t('today.decks')}
      </Link>
      {plan.backlogSpreadDays ? (
        <Banner>{t('study.notice.spread', { days: plan.backlogSpreadDays })}</Banner>
      ) : null}
      {snapshot.fewerNew === null ? null : (
        <FewerNewOffer
          proposed={snapshot.fewerNew}
          current={snapshot.config.planner.newPerSessionMax}
          days={plan.retention.lowStreakDays}
        />
      )}
      <Suspense fallback={null}>
        <FinalReviewOffers />
      </Suspense>
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
      {/* UX10: la pregunta del onboarding o, si la activó, su progreso; apagada, nada. */}
      <Suspense fallback={null}>
        <GamificationCard />
      </Suspense>
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
