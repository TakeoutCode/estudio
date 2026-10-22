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

describe('imágenes de assets borrados antes de purgarlos (SYNC §6)', () => {
  const USER = '0192f1a0-0000-7000-8000-000000000001';
  const ids = Array.from({ length: 101 }, (_, i) => `0192f1a0-0000-7000-8000-${String(i).padStart(12, '0')}`);
  const publicId = (id: string) => `estudio/${USER}/${id}`;

  it('sin CLOUDINARY_URL no se subió nada: todos se pueden purgar', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await new CloudinaryPurger(configWith(undefined)).deleteAssets(USER, ids)).toEqual(ids);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('borra de a 100 por su public_id; deleted y not_found cuentan, lo demás espera', async () => {
    const [first, second, ...rest] = ids;
    const last = ids.at(-1) ?? '';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json(200, {
          deleted: {
            [publicId(first ?? '')]: 'deleted',
            [publicId(second ?? '')]: 'not_found',
            ...Object.fromEntries(rest.slice(0, 98).map((id) => [publicId(id), 'error'])),
          },
        }),
      )
      .mockResolvedValueOnce(json(200, { deleted: { [publicId(last)]: 'deleted' } }));
    vi.stubGlobal('fetch', fetch);
    const purger = new CloudinaryPurger(configWith('cloudinary://123:secreto@mi-nube'));
    expect(await purger.deleteAssets(USER, ids)).toEqual([first, second, last]);
    const urls = fetch.mock.calls.map(
      ([url]) => new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url),
    );
    expect(urls.map((u) => u.searchParams.getAll('public_ids[]').length)).toEqual([100, 1]);
    expect(urls[1]?.searchParams.getAll('public_ids[]')).toEqual([publicId(last)]);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('si Cloudinary rechaza, lanza: la purga deja esos assets para mañana', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(401)));
    const purger = new CloudinaryPurger(configWith('cloudinary://123:secreto@mi-nube'));
    await expect(purger.deleteAssets(USER, ids.slice(0, 1))).rejects.toThrow('cloudinary_delete_failed_401');
  });
});
