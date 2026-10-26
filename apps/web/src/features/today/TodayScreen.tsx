import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { NotificationsAtOpen } from '@/features/notifications';
import { SleepCheckIn } from '@/features/sleep';
import { type PlanSnapshot, useTodayPlan } from '@/features/study';
import { loadFullCatalog } from '@/lib/i18n';
import { ActionBar } from '@/ui/ActionBar';
import { Banner } from '@/ui/Banner';
import { EmptyState } from '@/ui/EmptyState';
import { BowIcon, CardsIcon, HeartIcon, PlayIcon, PlusIcon, SparkleIcon } from '@/ui/icons';
import { LinkRow } from '@/ui/LinkRow';
import { Loading } from '@/ui/Loading';
import { PageHeader } from '@/ui/PageHeader';
import { FewerNewOffer } from './FewerNewOffer';

// FE9: la gamificación no entra en el JS inicial de Hoy; apagada, ni siquiera se muestra. Sus
// textos están en el resto del catálogo.
const GamificationCard = lazy(async () => {
  const [{ GamificationCard: Card }] = await Promise.all([
    import('@/features/gamification'),
    loadFullCatalog(),
  ]);
  return { default: Card };
});
// FE9: los exámenes tampoco; Hoy solo muestra su repaso previo (LD12).
const FinalReviewOffers = lazy(async () => {
  const [{ FinalReviewOffers: Offers }] = await Promise.all([import('@/features/exams'), loadFullCatalog()]);
  return { default: Offers };
});

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const primary = `inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy ${focus}`;
const secondary = `press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-(--radius-card) bg-surface px-4 font-bold text-primary shadow-card ${focus}`;

/**
 * Pantalla inicial: lo pendiente de hoy, sin metas ni lenguaje de atraso (§5, UX7). Mobile
 * first (UX2): la acción principal abajo, al alcance del pulgar; las otras secciones, en las
 * pestañas.
 */
export function TodayScreen() {
  const { t } = useTranslation();
  const snapshot = useTodayPlan();
  return (
    <>
      <PageHeader title={t('today.title')} eyebrow={t('today.greeting')} />
      <NotificationsAtOpen />
      <SleepCheckIn />
      {snapshot ? <Summary snapshot={snapshot} /> : <Loading />}
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
        <EmptyState
          message={
            plan.newCapReached ? t('study.notice.newCap', { count: plan.newStartedToday }) : t('today.empty')
          }
        />
      ) : (
        <section className="relative flex items-center gap-4 overflow-hidden rounded-(--radius-card) bg-linear-to-br from-blush from-10% to-surface to-60% p-5 shadow-card">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="m-0 text-card leading-snug font-extrabold">
              {t('today.pending', { count: plan.due })}
            </p>
            {news > 0 ? <p className="m-0 text-muted">{t('today.newCards', { count: news })}</p> : null}
            {plan.newCapReached ? (
              <p className="m-0 text-muted">{t('study.notice.newCap', { count: plan.newStartedToday })}</p>
            ) : null}
          </div>
          <span className="relative flex size-20 shrink-0 items-center justify-center rounded-full bg-surface text-bow shadow-card">
            <BowIcon className="w-13" />
            <HeartIcon className="absolute -top-1 -right-1 size-5 rotate-12 text-bow" />
            <SparkleIcon className="absolute -bottom-1 -left-2 size-4 text-line-strong" />
          </span>
        </section>
      )}
      {/* Elegir un solo mazo para estudiar, editarlos o pausarlos; Empezar mezcla los activos (R9). */}
      <LinkRow to="/decks" icon={<CardsIcon className="size-6" />}>
        {snapshot.pausedDecks > 0
          ? t('today.decksPaused', { count: snapshot.pausedDecks })
          : t('today.decks')}
      </LinkRow>
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
          <h2 id="today-improve" className="m-0 text-body font-extrabold">
            {t('today.improve.title')}
          </h2>
          <p className="m-0 text-caption text-muted">{t('today.improve.hint')}</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {toImprove.map((item) => (
              <li
                key={item.noteId}
                className="flex items-center justify-between gap-3 rounded-(--radius-card) bg-surface py-1 pr-1 pl-4 shadow-card"
              >
                <span className="line-clamp-2">{item.prompt}</span>
                <Link
                  className={`press inline-flex min-h-11 shrink-0 items-center rounded-(--radius-card) bg-blush px-4 font-bold text-primary ${focus}`}
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
            <PlayIcon className="size-5" />
            {t('today.start')}
          </Link>
        )}
        <Link className={nothing ? primary : secondary} to="/notes/new">
          <PlusIcon className="size-5" />
          {t('today.addCard')}
        </Link>
      </ActionBar>
    </>
  );
}
