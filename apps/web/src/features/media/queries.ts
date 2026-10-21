import { type MediaAsset, noteImageAssetId } from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '@/db/schema';
import { env } from '@/lib/env';
import { cloudinaryImageUrl, deliveryWidth } from '@/lib/media';

/** De dónde sale la imagen: su copia sin subir, Cloudinary, o ninguna todavía. */
export type ImageSource =
  | { readonly kind: 'local'; readonly url: string }
  | { readonly kind: 'remote'; readonly url: string }
  /** `pending`: otro dispositivo aún no la sube. `unconfigured`: falta la nube (FE8). */
  | { readonly kind: 'unavailable'; readonly reason: 'pending' | 'unconfigured' };

export interface MediaImageView {
  readonly asset: MediaAsset;
  /** `undefined` mientras se arma la URL de la copia local. */
  readonly source: ImageSource | undefined;
}

/** URL de Cloudinary con el ancho que pide esta pantalla (FE8); `null` si falta algo. */
export function remoteImageUrl(asset: MediaAsset, cssWidth: number, dpr: number): string | null {
  const cloudName = env.VITE_CLOUDINARY_CLOUD_NAME;
  if (!cloudName || asset.publicId === null || asset.version === null) return null;
  return cloudinaryImageUrl({
    cloudName,
    publicId: asset.publicId,
    version: asset.version,
    width: deliveryWidth(cssWidth, dpr),
  });
}

/**
 * Imágenes ya subidas de las notas de oclusión de estas tarjetas, en el orden de la cola y sin
 * repetir; las que siguen en este dispositivo no hace falta pedirlas.
 */
export const useImageUrlsForCards = (cardIds: readonly string[], cssWidth: number) =>
  useLiveQuery(async () => {
    const cards = await db.cards.bulkGet([...cardIds]);
    const notes = await db.notes.bulkGet([...new Set(cards.flatMap((c) => (c ? [c.noteId] : [])))]);
    const assetIds = [
      ...new Set(notes.flatMap((n) => (n?.deletedAt === null ? (noteImageAssetId(n.content) ?? []) : []))),
    ];
    const assets = await db.mediaAssets.bulkGet(assetIds);
    return assets.flatMap((asset) => {
      const url = asset?.deletedAt === null ? remoteImageUrl(asset, cssWidth, window.devicePixelRatio) : null;
      return url ? [url] : [];
    });
  }, [cardIds.join(','), cssWidth]);

/** URL `blob:` de la copia sin subir; se libera al dejar de usarse. */
function useLocalCopy(assetId: string, hasCopy: boolean): string | null {
  const [local, setLocal] = useState<{ readonly assetId: string; readonly url: string } | null>(null);
  useEffect(() => {
    if (!hasCopy) return;
    let cancelled = false;
    let url: string | null = null;
    void db.pendingUploads.get(assetId).then((copy) => {
      if (cancelled || !copy) return;
      url = URL.createObjectURL(new Blob([copy.data], { type: copy.mime }));
      setLocal({ assetId, url });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [assetId, hasCopy]);
  return hasCopy && local?.assetId === assetId ? local.url : null;
}

/**
 * FE8: la imagen de un `MediaAsset`. Mientras este dispositivo no la sube, se ve desde su copia
 * en Dexie; después, desde Cloudinary. `null` si el asset no existe o está borrado.
 */
export function useMediaImage(assetId: string, cssWidth: number): MediaImageView | null | undefined {
  const found = useLiveQuery(async () => {
    const asset = await db.mediaAssets.get(assetId);
    if (asset?.deletedAt !== null) return null;
    // Sin leer los bytes: solo si la copia sigue aquí.
    return { asset, hasCopy: (await db.pendingUploads.where('assetId').equals(assetId).count()) > 0 };
  }, [assetId]);
  const hasCopy = found?.hasCopy ?? false;
  const localUrl = useLocalCopy(assetId, hasCopy);

  if (found === undefined || found === null) return found;
  const { asset } = found;
  if (hasCopy) return { asset, source: localUrl ? { kind: 'local', url: localUrl } : undefined };
  const remote = remoteImageUrl(asset, cssWidth, window.devicePixelRatio);
  if (remote) return { asset, source: { kind: 'remote', url: remote } };
  return {
    asset,
    source: { kind: 'unavailable', reason: asset.publicId === null ? 'pending' : 'unconfigured' },
  };
}
