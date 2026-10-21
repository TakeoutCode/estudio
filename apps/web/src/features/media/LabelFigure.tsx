import { type LabelImageContent, numberedLabels, type OcclusionRect } from '@estudio/shared';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaImage } from './MediaImage';
import { CARD_IMAGE_WIDTH } from './OcclusionFigure';

const place = (r: OcclusionRect): CSSProperties => ({
  left: `${String(r.x * 100)}%`,
  top: `${String(r.y * 100)}%`,
  width: `${String(r.w * 100)}%`,
  height: `${String(r.h * 100)}%`,
});

/**
 * LD §2 (`label_image`): la imagen con todas sus etiquetas tapadas y numeradas. Antes del intento
 * los nombres no están en el DOM (R1); al revelar quedan los bordes con su número, para ver qué
 * había debajo. UX4: cada recuadro se anuncia por su número, nunca por su nombre.
 */
export function LabelFigure({
  content,
  revealed,
  eager = false,
}: {
  readonly content: LabelImageContent;
  readonly revealed: boolean;
  readonly eager?: boolean;
}) {
  const { t } = useTranslation();
  const labels = numberedLabels(content);
  return (
    <MediaImage assetId={content.imageAssetId} alt={content.alt} cssWidth={CARD_IMAGE_WIDTH} eager={eager}>
      {labels.map((label, index) =>
        label.rects.map((rect, i) => {
          const key = `${String(label.n)}-${String(i)}`;
          const number = String(index + 1);
          return revealed ? (
            <span
              key={key}
              aria-hidden
              className="absolute rounded-sm border-2 border-primary"
              style={place(rect)}
            >
              <span className="absolute -top-2 -left-2 rounded-full bg-primary px-1.5 text-caption font-semibold text-primary-contrast">
                {number}
              </span>
            </span>
          ) : (
            <span
              key={key}
              role={i === 0 ? 'img' : undefined}
              aria-label={
                i === 0 ? t('exercises.labelImage.masked', { n: index + 1, total: labels.length }) : undefined
              }
              aria-hidden={i === 0 ? undefined : true}
              className="absolute flex items-center justify-center rounded-sm bg-primary font-semibold text-primary-contrast ring-2 ring-primary-contrast"
              style={place(rect)}
            >
              {number}
            </span>
          );
        }),
      )}
    </MediaImage>
  );
}
