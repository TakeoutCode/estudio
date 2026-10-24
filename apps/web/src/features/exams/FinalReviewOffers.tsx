import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Banner } from '@/ui/Banner';
import { useExamsOverview } from './queries';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * LD12: en los últimos días antes de un examen, la vuelta de repaso previa. Va en Hoy, que lo
 * carga con `lazy()`: así los exámenes no entran en el JS inicial (FE9).
 */
export function FinalReviewOffers() {
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
