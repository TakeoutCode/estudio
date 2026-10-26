import { waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { useAuth } from '@/features/auth';
import { createDeck } from '@/features/decks';
import { captureClientErrors, reportRouteError, startSync, useSyncStatus } from './index';

const api = vi.hoisted(() => ({ authorizedApi: vi.fn() }));
vi.mock('@/features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth')>()),
  authorizedApi: api.authorizedApi,
}));

const T0 = Date.UTC(2026, 9, 20, 15); // QA1: reloj falso, nunca el real
const SESSION = { userId: '0192f1a0-0000-7000-8000-00000000c0de', accessToken: 't', expiresAt: 9e12 };

/** La API de sync, sin red: acepta todo lo que se empuja y no trae nada nuevo. */
const fakeApi = (path: string, init?: { body?: unknown }) => {
  if (path === '/sync/push') {
    const { mutations } = init?.body as { mutations: { mutationId: string }[] };
    return Promise.resolve({
      results: mutations.map((m) => ({ mutationId: m.mutationId, status: 'applied' })),
    });
  }
  if (path.startsWith('/sync/pull')) {
    return Promise.resolve({ changes: [], cursor: '0', hasMore: false, serverNow: T0 });
  }
  return Promise.resolve(undefined);
};
const calls = (prefix: string) =>
  api.authorizedApi.mock.calls.filter(([path]) => typeof path === 'string' && path.startsWith(prefix)).length;
const idle = () =>
  waitFor(() => {
    expect(useSyncStatus.getState().state).toBe('idle');
  });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: SESSION.userId });
  api.authorizedApi.mockImplementation(fakeApi);
});

afterAll(() => {
  vi.useRealTimers();
  useAuth.setState({ session: null });
});

describe('SY8: cuándo corre la sync (sync/index.ts)', () => {
  it('sin sesión no pide nada; al iniciarla, envía el outbox y hace pull', async () => {
    await createDeck({ name: 'Hombro' });
    startSync();
    await waitFor(() => {
      expect(useSyncStatus.getState().state).toBe('signed_out');
    });
    expect(api.authorizedApi).not.toHaveBeenCalled();

    useAuth.getState().signIn(SESSION);
    await idle();
    expect(calls('/sync/push')).toBe(1);
    expect(calls('/sync/pull')).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('con la red de vuelta y al volver a primer plano, otra vuelta; abrirla dos veces no duplica', async () => {
    startSync(); // ya arrancó: no agrega otros oyentes
    const before = calls('/sync/pull');
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(calls('/sync/pull')).toBe(before + 1);
    });
    await idle();

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => {
      expect(calls('/sync/pull')).toBe(before + 2);
    });
    await idle();
  });

  it('con Web Locks, una pestaña que no obtiene el lock no sincroniza (SYNC §4)', async () => {
    let available = false;
    const request = vi.fn((_name: string, _options: unknown, task: (lock: unknown) => Promise<void>) =>
      task(available ? { name: 'estudio-sync' } : null),
    );
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    try {
      const before = calls('/sync/pull');
      window.dispatchEvent(new Event('online'));
      await waitFor(() => {
        expect(request).toHaveBeenCalledTimes(1);
      });
      await idle();
      expect(calls('/sync/pull')).toBe(before); // otra pestaña la tiene

      available = true;
      window.dispatchEvent(new Event('online'));
      await waitFor(() => {
        expect(calls('/sync/pull')).toBe(before + 1);
      });
      await idle();
    } finally {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });
});

describe('FE13: errores del cliente', () => {
  it('los de una ruta y los sin atrapar quedan guardados, sin ids en la ruta', async () => {
    await db.diagnostics.clear();
    reportRouteError(new Error('falló la ruta'), `/decks/${SESSION.userId}`);
    captureClientErrors();
    captureClientErrors(); // una sola vez
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('sin atrapar'), message: 'sin atrapar' }),
    );
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: new TypeError('promesa rechazada') });
    window.dispatchEvent(rejection);
    await waitFor(async () => {
      expect(await db.diagnostics.count()).toBe(3);
    });
    const routes = (await db.diagnostics.toArray()).map((d) => d.route);
    expect(routes).toContain('/decks/:id');
  });
});
