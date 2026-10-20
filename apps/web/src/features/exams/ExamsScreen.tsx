import type { Exam } from '@estudio/shared';
import type { ExamPlan } from '@estudio/srs';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActionBar } from '@/ui/ActionBar';
import { EmptyState } from '@/ui/EmptyState';
import { type ExamsOverview, useExamsOverview } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const link = `inline-flex min-h-11 items-center px-2 text-primary ${focus}`;
const primary = `inline-flex min-h-14 w-full items-center justify-center rounded-(--radius-card) bg-primary px-4 font-medium text-primary-contrast ${focus}`;

/**
 * R11 y LD11: cada examen con su plan por tema. Informa y sugiere, sin cuentas regresivas ni
 * urgencia (R19, UX7): los días se dicen como "días para estudiar".
 */
export function ExamsScreen() {
  const { t } = useTranslation();
  const overview = useExamsOverview();
  if (!overview) return null;
  const upcoming = overview.exams.filter((e) => !overview.plans.get(e.id)?.past);
  const past = overview.exams.filter((e) => overview.plans.get(e.id)?.past);
  return (
    <>
      <header className="flex min-h-11 items-center justify-between gap-3">
        <Link className={`-ml-2 ${link}`} to="/">
          {t('exams.back')}
        </Link>
        <h1 className="m-0 text-body font-semibold">{t('exams.title')}</h1>
        <span className="min-w-11" />
      </header>
      {upcoming.length === 0 ? <EmptyState message={t('exams.empty')} /> : null}
      {upcoming.map((exam) => {
        const plan = overview.plans.get(exam.id);
        return plan ? <ExamCard key={exam.id} exam={exam} plan={plan} overview={overview} /> : null;
      })}
      {past.length > 0 ? (
        <section className="flex flex-col gap-1" aria-labelledby="exams-past">
          <h2 id="exams-past" className="m-0 text-caption font-normal text-muted">
            {t('exams.past')}
          </h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {past.map((exam) => (
              <li key={exam.id} className="flex items-center justify-between gap-3">
                <span>
                  {exam.title} · <ExamDate exam={exam} timeZone={overview.timeZone} />
                </span>
                <Link className={`-mr-2 shrink-0 ${link}`} to={`/exams/${exam.id}`}>
                  {t('exams.edit')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ActionBar>
        <Link className={primary} to="/exams/new">
          {t('exams.new')}
        </Link>
      </ActionBar>
    </>
  );
}

function ExamDate({ exam, timeZone }: { readonly exam: Exam; readonly timeZone: string }) {
  const { i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  });
  return <>{format.format(exam.date)}</>;
}

function ExamCard({
  exam,
  plan,
  overview,
}: {
  readonly exam: Exam;
  readonly plan: ExamPlan;
  readonly overview: ExamsOverview;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-(--radius-card) bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h2 id={id} className="m-0 text-title font-semibold">
            {exam.title}
          </h2>
          <p className="m-0 text-muted">
            <ExamDate exam={exam} timeZone={overview.timeZone} /> ·{' '}
            {plan.daysLeft === 0 ? t('exams.today') : t('exams.days', { count: plan.daysLeft })}
          </p>
        </div>
        <Link className={`-mr-2 shrink-0 ${link}`} to={`/exams/${exam.id}`}>
          {t('exams.edit')}
        </Link>
      </div>
      {plan.newRemaining > 0 && plan.daysLeft > 0 ? (
        <p className="m-0">{t('exams.suggested', { count: plan.suggestedNewPerDay })}</p>
      ) : null}
      {plan.newRemaining === 0 && plan.topics.length > 0 ? (
        <p className="m-0">{t('exams.allStarted')}</p>
      ) : null}
      {plan.beyondCap > 0 && plan.daysLeft > 0 ? (
        <p className="m-0 text-caption text-muted">
          {t('exams.beyondCap', { count: plan.beyondCap, cap: overview.config.planner.newPerSessionMax })}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-1 border-t border-muted/30 p-0 pt-2">
        {plan.topics.map((topic) => (
          <li key={topic.topicId} className="flex items-baseline justify-between gap-3">
            <span>{overview.topics.get(topic.topicId)?.name}</span>
            <span className="shrink-0 text-caption text-muted">
              {topic.newRemaining > 0
                ? t('exams.topicNew', { count: topic.newRemaining })
                : t('exams.topicStarted')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
