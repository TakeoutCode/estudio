import { newId } from '@estudio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freeMediaCache, isQuotaError, MEDIA_CACHE, retryOnQuota } from './quota';
import { EstudioDb } from './schema';

const expiration = vi.hoisted(() => ({ maxEntries: [] as number[] }));
vi.mock('workbox-expiration', () => ({
  CacheExpiration: class {
    constructor(_name: string, config: { maxEntries: number }) {
      expiration.maxEntries.push(config.maxEntries);
    }
    expireEntries() {
      return Promise.resolve();
    }
  },
}));

const quota = () => new DOMException('Sin espacio', 'QuotaExceededError');

afterEach(() => {
  vi.unstubAllGlobals();
  expiration.maxEntries.length = 0;
});

describe('FE7: sin espacio en el dispositivo', () => {
  it('reconoce el error de cuota directo o como causa del aborto de Dexie', () => {
    expect(isQuotaError(quota())).toBe(true);
    expect(isQuotaError({ name: 'AbortError', inner: quota() })).toBe(true);
    expect(isQuotaError(new Error('otro'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('libera espacio y repite una vez; otro error, o nada que liberar, sigue de largo', async () => {
    const freeSpace = vi.fn(() => Promise.resolve(true));
    const run = vi.fn().mockRejectedValueOnce(quota()).mockResolvedValueOnce('guardado');
    expect(await retryOnQuota(run, freeSpace)).toBe('guardado');
    expect(freeSpace).toHaveBeenCalledOnce();

    const other = new Error('otro');
    await expect(retryOnQuota(() => Promise.reject(other), freeSpace)).rejects.toBe(other);
    expect(freeSpace).toHaveBeenCalledOnce();

    const nothing = vi.fn(() => Promise.resolve(false));
    await expect(retryOnQuota(() => Promise.reject(quota()), nothing)).rejects.toThrow('Sin espacio');
  });

  it('una transacción que no cupo se repite después de liberar la caché, y queda guardada', async () => {
    const freeSpace = vi.fn(() => Promise.resolve(true));
    const database = new EstudioDb(`cuota-${newId()}`, freeSpace);
    let attempts = 0;
    await database.transaction('rw', database.meta, async () => {
      attempts += 1;
      await database.meta.put({ key: 'nota', value: attempts });
      // Dentro de la misma transacción: una anidada no se repite por su cuenta.
      await database.transaction('rw', database.meta, () => database.meta.put({ key: 'anidada', value: 1 }));
      if (attempts === 1) throw quota();
    });
    expect(attempts).toBe(2);
    expect(freeSpace).toHaveBeenCalledOnce();
    expect(await database.meta.get('nota')).toEqual({ key: 'nota', value: 2 });
    await database.delete();
  });

  it('libera la mitad de la caché de media que hace más tiempo que no se ve; nunca Dexie', async () => {
    const keys = Array.from({ length: 9 }, (_, i) => new Request(`https://res.cloudinary.com/${String(i)}`));
    const open = vi.fn(() => Promise.resolve({ keys: () => Promise.resolve(keys), delete: vi.fn() }));
    vi.stubGlobal('caches', { open });
    expect(await freeMediaCache()).toBe(true);
    expect(open).toHaveBeenCalledWith(MEDIA_CACHE);
    expect(expiration.maxEntries).toEqual([4]);

    vi.stubGlobal('caches', { open: () => Promise.resolve({ keys: () => Promise.resolve([]) }) });
    expect(await freeMediaCache()).toBe(false);
  });
});
