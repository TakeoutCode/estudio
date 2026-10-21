import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaImage } from './queries';

/**
 * FE8: una imagen por su `MediaAsset.id`, nunca por URL. La caja tiene la proporción de la
 * imagen antes de que cargue, así lo que va encima (`children`, en 0-1) queda en su lugar.
 * UX5: sobre `--color-surface` con un borde, sin invertir ni filtrar en modo oscuro.
 */
export function MediaImage({
  assetId,
  alt,
  cssWidth,
  eager = false,
  children,
}: {
  readonly assetId: string;
  readonly alt: string;
  /** Ancho máximo en px CSS en esta pantalla: elige qué tamaño pedir a Cloudinary. */
  readonly cssWidth: number;
  /** FE9: la tarjeta actual carga ya; el resto, con `loading="lazy"`. */
  readonly eager?: boolean;
  readonly children?: ReactNode;
}) {
  const { t } = useTranslation();
  const view = useMediaImage(assetId, cssWidth);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (view === undefined) return null;
  if (view === null) return <p className="m-0 text-caption text-muted">{t('media.unavailable')}</p>;
  const { asset, source } = view;
  const url = source && source.kind !== 'unavailable' ? source.url : null;
  const notice =
    source?.kind === 'unavailable'
      ? t(source.reason === 'pending' ? 'media.pendingElsewhere' : 'media.unavailable')
      : url !== null && failedUrl === url
        ? t('media.offline') // UX3: sin conexión no es un error
        : null;
  return (
    <div
      className="relative w-full overflow-hidden rounded-(--radius-card) border border-muted/40 bg-surface"
      style={{ aspectRatio: `${String(asset.width)} / ${String(asset.height)}` }}
    >
      {url !== null && failedUrl !== url ? (
        <img
          src={url}
          alt={alt}
          width={asset.width}
          height={asset.height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // Con CORS la respuesta no es opaca y el service worker la guarda sin inflar la cuota.
          crossOrigin={source?.kind === 'remote' ? 'anonymous' : undefined}
          className="absolute inset-0 size-full object-contain"
          onError={() => {
            setFailedUrl(url);
          }}
        />
      ) : null}
      {notice ? (
        <p
          role="note"
          className="absolute inset-0 m-0 flex items-center justify-center p-4 text-center text-caption text-muted"
        >
          {notice}
        </p>
      ) : null}
      {children}
    </div>
  );
}
