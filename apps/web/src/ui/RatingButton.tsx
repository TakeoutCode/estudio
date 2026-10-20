import { Rating } from '@estudio/shared';
import { useTranslation } from 'react-i18next';

// UI-UX UX1: `Otra vez` en tono neutro, nunca rojo (R19: fallar es esperable); el resto en
// una escala de primario. La etiqueta siempre acompaña al color (UX4).

const STYLE: Record<Rating, string> = {
  [Rating.Again]: 'border border-muted/40 bg-surface text-text',
  [Rating.Hard]: 'bg-primary/20 text-text',
  [Rating.Good]: 'bg-primary text-primary-contrast',
  [Rating.Easy]: 'bg-primary/40 text-text',
};

const LABEL = {
  [Rating.Again]: 'study.rate.again',
  [Rating.Hard]: 'study.rate.hard',
  [Rating.Good]: 'study.rate.good',
  [Rating.Easy]: 'study.rate.easy',
} as const;

export function RatingButton({
  rating,
  onRate,
  disabled = false,
}: {
  readonly rating: Rating;
  readonly onRate: (rating: Rating) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`min-h-14 rounded-(--radius-card) px-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${STYLE[rating]}`}
      aria-keyshortcuts={String(rating)}
      disabled={disabled}
      onClick={() => {
        onRate(rating);
      }}
    >
      {t(LABEL[rating])}
    </button>
  );
}
