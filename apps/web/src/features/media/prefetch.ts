import { useEffect } from 'react';
import { useImageUrlsForCards } from './queries';

/** Más de esto en una sesión no hace falta de una vez: el resto se pide al verse. */
const PREFETCH_LIMIT = 40;

/**
 * FRONTEND §5: pide las imágenes de las tarjetas de la sesión con la misma URL que usará cada
 * tarjeta, así el service worker las guarda y se ven aunque se vaya la señal a mitad (FE7).
 */
export function usePrefetchCardImages(cardIds: readonly string[], cssWidth: number): void {
  const urls = useImageUrlsForCards(cardIds, cssWidth);
  const key = (urls ?? []).slice(0, PREFETCH_LIMIT).join('\n');
  useEffect(() => {
    if (key === '' || !navigator.onLine) return;
    for (const url of key.split('\n')) {
      const image = new Image();
      image.crossOrigin = 'anonymous'; // la misma petición CORS que hace la tarjeta
      image.src = url;
    }
  }, [key]);
}
