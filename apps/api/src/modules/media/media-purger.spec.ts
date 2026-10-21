import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { CloudinaryPurger } from './media-purger.js';

const configWith = (url: string | undefined) => ({ get: () => url }) as unknown as AppConfig;
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('purga de la carpeta en Cloudinary (QUALITY QA6, BE13)', () => {
  it('sin CLOUDINARY_URL no llama a nada', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await new CloudinaryPurger(configWith(undefined)).purgeUser('u')).toBe('unconfigured');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('borra por prefijo hasta que no queda nada, luego la carpeta; una carpeta que no existe no es error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { deleted: {}, partial: true, next_cursor: 'c1' }))
      .mockResolvedValueOnce(json(200, { deleted: {} }))
      .mockResolvedValueOnce(json(404));
    vi.stubGlobal('fetch', fetch);
    const purger = new CloudinaryPurger(configWith('cloudinary://123:secreto@mi-nube'));
    expect(await purger.purgeUser('0192f1a0-0000-7000-8000-000000000001')).toBe('purged');
    const urls = fetch.mock.calls.map(([url]) =>
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
    );
    expect(urls).toEqual([
      'https://api.cloudinary.com/v1_1/mi-nube/resources/image/upload?prefix=estudio%2F0192f1a0-0000-7000-8000-000000000001%2F',
      'https://api.cloudinary.com/v1_1/mi-nube/resources/image/upload?prefix=estudio%2F0192f1a0-0000-7000-8000-000000000001%2F&next_cursor=c1',
      'https://api.cloudinary.com/v1_1/mi-nube/folders/estudio/0192f1a0-0000-7000-8000-000000000001',
    ]);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('123:secreto').toString('base64')}`,
    );
  });

  it('reintenta un 5xx con espera y falla si Cloudinary sigue caído o rechaza', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(json(200, {}));
    vi.stubGlobal('fetch', fetch);
    const purger = new CloudinaryPurger(configWith('cloudinary://123:secreto@mi-nube'));
    const done = purger.purgeUser('u');
    await vi.runAllTimersAsync();
    expect(await done).toBe('purged');
    expect(fetch).toHaveBeenCalledTimes(3);

    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(401)));
    await expect(purger.purgeUser('u')).rejects.toThrow('cloudinary_purge_failed_401');
  });
});
