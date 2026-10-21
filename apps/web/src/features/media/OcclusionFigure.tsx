import { type ImageOcclusionContent, occlusionTarget, type OcclusionRect } from '@estudio/shared';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaImage } from './MediaImage';

/**
 * Ancho máximo de la imagen en una tarjeta (px CSS). La sesión y la precarga piden el mismo
 * tamaño a Cloudinary, así sin red sale de la caché (FE7).
 */
export const CARD_IMAGE_WIDTH = 600;

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const place = (r: OcclusionRect): CSSProperties => ({
  left: `${String(r.x * 100)}%`,
  top: `${String(r.y * 100)}%`,
  width: `${String(r.w * 100)}%`,
  height: `${String(r.h * 100)}%`,
});

/**
 * R10, LD1: la imagen con sus etiquetas tapadas para la Card `ordinal`. Antes del intento, la
 * etiqueta que se pregunta va resaltada con "?" (R1: su texto no está en el DOM); al revelar
 * queda solo su borde. Con `hide_all` las demás siguen tapadas. UX4: la que se pregunta se
 * anuncia como "Etiqueta oculta 3 de 7" y, si se puede, tocarla es como "Mostrar".
 */
export function OcclusionFigure({
  content,
  ordinal,
  revealed,
  onReveal = null,
  eager = false,
}: {
  readonly content: ImageOcclusionContent;
  readonly ordinal: number;
  readonly revealed: boolean;
  /** `null` cuando revelar no se hace desde la imagen (p. ej. falta la confianza, R6). */
  readonly onReveal?: (() => void) | null;
  readonly eager?: boolean;
}) {
  const { t } = useTranslation();
  const target = occlusionTarget(content, ordinal);
  const name = target ? { position: target.position, total: target.total } : { position: 0, total: 0 };
  return (
    <MediaImage assetId={content.imageAssetId} alt={content.alt} cssWidth={CARD_IMAGE_WIDTH} eager={eager}>
      {content.groups.map((group) => {
        const isTarget = group.n === target?.group.n;
        if (!isTarget && content.mode === 'hide_one') return null;
        return group.rects.map((rect, i) => {
          const key = `${String(group.n)}-${String(i)}`;
          if (!isTarget) {
            return (
              <span
                key={key}
                role="img"
                aria-label={i === 0 ? t('occlusion.otherHidden') : undefined}
                aria-hidden={i === 0 ? undefined : true}
                className="absolute rounded-sm bg-muted"
                style={place(rect)}
              />
            );
          }
          if (revealed) {
            return (
              <span
                key={key}
                aria-hidden
                className="absolute rounded-sm border-2 border-primary"
                style={place(rect)}
              />
            );
          }
          const mask =
            'absolute flex items-center justify-center rounded-sm bg-primary font-semibold text-primary-contrast ring-2 ring-primary-contrast';
          // Un solo control por etiqueta, aunque la tapen varios recuadros.
          return onReveal && i === 0 ? (
            <button
              key={key}
              type="button"
              className={`${mask} ${focus}`}
              style={place(rect)}
              aria-label={t('occlusion.targetHidden', name)}
              onClick={onReveal}
            >
              ?
            </button>
          ) : (
            <span
              key={key}
              role={i === 0 ? 'img' : undefined}
              aria-label={i === 0 ? t('occlusion.targetHidden', name) : undefined}
              aria-hidden={i === 0 ? undefined : true}
              className={mask}
              style={place(rect)}
            >
              ?
            </span>
          );
        });
      })}
    </MediaImage>
  );
}
