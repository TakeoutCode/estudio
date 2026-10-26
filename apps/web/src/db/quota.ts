/** La caché donde el service worker guarda las imágenes de Cloudinary (`sw.ts`, FRONTEND §5). */
export const MEDIA_CACHE = 'media';

/** Un `QuotaExceededError`, directo o como causa del aborto de una transacción de Dexie. */
export function isQuotaError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if ('name' in current && current.name === 'QuotaExceededError') return true;
    current = 'inner' in current ? current.inner : null;
  }
  return false;
}

/**
 * FRONTEND FE7: sin espacio, se libera la mitad de la caché de media que hace más tiempo que no
 * se ve, con la marca que el `ExpirationPlugin` del service worker actualiza en cada uso. Una
 * imagen liberada se vuelve a bajar al verla con red. Nunca toca Dexie. `false` si no había nada.
 */
export async function freeMediaCache(): Promise<boolean> {
  if (!('caches' in globalThis)) return false;
  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  if (keys.length === 0) return false;
  const keep = Math.floor(keys.length / 2);
  if (keep === 0) {
    await Promise.all(keys.map((request) => cache.delete(request)));
    return true;
  }
  const { CacheExpiration } = await import('workbox-expiration');
  await new CacheExpiration(MEDIA_CACHE, { maxEntries: keep }).expireEntries();
  return true;
}

/**
 * Corre `run` y, si falla por falta de espacio, libera espacio y lo repite una vez. Una
 * transacción abortada no dejó nada escrito, así que repetirla es seguro.
 */
export async function retryOnQuota<T>(
  run: () => PromiseLike<T>,
  freeSpace: () => Promise<boolean> = freeMediaCache,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isQuotaError(error) || !(await freeSpace().catch(() => false))) throw error;
    return run();
  }
}
