import { CONTRACT_HEADER, CONTRACT_VERSION } from '@estudio/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, type ApiClientDeps, createApiClient } from './api';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(status, { type: 'x', title: 'x', status, code }, headers);

const client = (responses: Response[], overrides: Partial<ApiClientDeps> = {}) => {
  let token = 'viejo';
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(responses.shift() ?? json(200, {})));
  const refresh = vi.fn(() => {
    token = 'nuevo';
    return Promise.resolve(true);
  });
  const onContractOutdated = vi.fn();
  const deps: ApiClientDeps = {
    baseUrl: 'http://api.test',
    fetch: fetchMock,
    getAccessToken: () => token,
    refresh,
    onContractOutdated,
    ...overrides,
  };
  return { request: createApiClient(deps), fetchMock, refresh, onContractOutdated };
};

const Ok = z.object({ ok: z.boolean() });

describe('cliente HTTP', () => {
  it('ARC6 y BE11: manda la cabecera de contrato, el Bearer y las credenciales', async () => {
    const { request, fetchMock } = client([json(200, { ok: true })]);
    expect(await request('/x', { schema: Ok })).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.test/x');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toMatchObject({
      [CONTRACT_HEADER]: String(CONTRACT_VERSION),
      authorization: 'Bearer viejo',
    });
  });

  it('ante un 401 refresca una vez y reintenta con el token nuevo', async () => {
    const { request, fetchMock, refresh } = client([problem(401, 'unauthorized'), json(200, { ok: true })]);
    expect(await request('/x', { schema: Ok })).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer nuevo' });
  });

  it('si el refresh falla, el 401 llega como unauthorized', async () => {
    const { request } = client([problem(401, 'unauthorized')], { refresh: () => Promise.resolve(false) });
    await expect(request('/x', { schema: Ok })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('los endpoints de auth no mandan Bearer ni intentan refrescar', async () => {
    const { request, fetchMock, refresh } = client([problem(401, 'unauthorized')]);
    await expect(
      request('/auth/login', { method: 'POST', body: {}, schema: Ok, auth: false }),
    ).rejects.toThrow();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('426 avisa que hay que actualizar la app', async () => {
    const { request, onContractOutdated } = client([problem(426, 'contract_outdated')]);
    await expect(request('/x', { schema: Ok })).rejects.toMatchObject({ code: 'contract_outdated' });
    expect(onContractOutdated).toHaveBeenCalledTimes(1);
  });

  it('lee Retry-After y traduce los fallos de red', async () => {
    const { request } = client([problem(429, 'rate_limited', { 'retry-after': '30' })]);
    await expect(request('/x', { schema: Ok })).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 30_000,
    });
    const offline = client([], { fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(offline.request('/x', { schema: Ok })).rejects.toEqual(new ApiError(0, 'network'));
  });

  it('una respuesta 202 sin cuerpo se valida como undefined', async () => {
    const { request } = client([new Response(null, { status: 202 })]);
    await expect(
      request('/auth/register', { method: 'POST', body: {}, schema: z.undefined(), auth: false }),
    ).resolves.toBeUndefined();
  });
});
