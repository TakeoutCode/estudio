import { type Credentials, SessionResponseSchema } from '@estudio/shared';
import { z } from 'zod';

import { ApiError, type ApiClient, createApiClient } from '@/lib/api';
import { useAppStatus } from '@/lib/app-status';
import { env } from '@/lib/env';
import { type AccountDb, bindDeviceToAccount, wipeDevice } from './commands';
import { useAuth } from './store';

export type RefreshOutcome = 'ok' | 'signed_out' | 'offline';

const markOutdated = () => {
  useAppStatus.getState().markContractOutdated();
};

/** Cliente de /auth: sin Bearer y sin reintento por 401 (no hay a qué refrescar). */
let authRequest: ApiClient = createApiClient({
  baseUrl: env.VITE_API_URL,
  fetch: (input, init) => fetch(input, init),
  getAccessToken: () => null,
  refresh: () => Promise.resolve(false),
  onContractOutdated: markOutdated,
});

/** Solo para pruebas: reemplaza el cliente de /auth. */
export const setAuthClientForTests = (client: ApiClient) => {
  authRequest = client;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withLock = <T>(name: string, task: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks.request(name, task) : task();

async function doRefresh(): Promise<RefreshOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const session = await authRequest('/auth/refresh', {
        method: 'POST',
        schema: SessionResponseSchema,
        auth: false,
      });
      useAuth.getState().signIn(session);
      return 'ok';
    } catch (error) {
      // Otra pestaña acaba de rotar la cookie: el navegador ya tiene la nueva (BE10).
      if (error instanceof ApiError && error.code === 'conflict' && attempt === 0) {
        await sleep(300);
        continue;
      }
      // Sin red o servidor caído: la sesión puede seguir siendo válida; no se cierra.
      if (error instanceof ApiError && (error.code === 'network' || error.status >= 500)) return 'offline';
      useAuth.getState().signOut();
      return 'signed_out';
    }
  }
  return 'signed_out';
}

let inflight: Promise<RefreshOutcome> | undefined;

/** Un solo refresh a la vez, también entre pestañas (Web Locks). */
export function refreshSession(): Promise<RefreshOutcome> {
  inflight ??= withLock('estudio-auth-refresh', doRefresh).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

export async function login(credentials: Credentials, database?: AccountDb): Promise<void> {
  const session = await authRequest('/auth/login', {
    method: 'POST',
    body: credentials,
    schema: SessionResponseSchema,
    auth: false,
  });
  await bindDeviceToAccount(session.userId, database);
  useAuth.getState().signIn(session);
}

/** El registro siempre responde 202 (BE10); si el correo no está permitido, el login falla. */
export async function register(credentials: Credentials, database?: AccountDb): Promise<void> {
  await authRequest('/auth/register', {
    method: 'POST',
    body: credentials,
    schema: z.undefined(),
    auth: false,
  });
  await login(credentials, database);
}

/** Cierra la sesión de este dispositivo. Los datos locales se quedan (local-first). */
export async function logout(): Promise<void> {
  try {
    await authRequest('/auth/logout', { method: 'POST', schema: z.undefined(), auth: false });
  } finally {
    useAuth.getState().signOut();
  }
}

/** Caché del service worker con sus imágenes (FRONTEND §5). */
const MEDIA_CACHE = 'media';

/**
 * QUALITY QA6: borra la cuenta en el servidor (con su contraseña) y, solo si eso funcionó,
 * todo lo de este dispositivo: Dexie y las imágenes guardadas. Sin red, falla sin tocar nada.
 */
export async function deleteAccount(password: string, database?: AccountDb): Promise<void> {
  await authorizedApi('/me', { method: 'DELETE', body: { password }, schema: z.undefined() });
  await wipeDevice(database);
  try {
    if ('caches' in globalThis) await caches.delete(MEDIA_CACHE);
  } catch {
    // Sin Cache Storage (o bloqueada) no hay imágenes que borrar.
  }
  useAuth.getState().signOut();
}

/** Cliente para todo lo que exige sesión: agrega el Bearer y refresca una vez ante un 401. */
export const authorizedApi: ApiClient = createApiClient({
  baseUrl: env.VITE_API_URL,
  fetch: (input, init) => fetch(input, init),
  getAccessToken: () => useAuth.getState().session?.accessToken ?? null,
  refresh: async () => (await refreshSession()) === 'ok',
  onContractOutdated: markOutdated,
});
