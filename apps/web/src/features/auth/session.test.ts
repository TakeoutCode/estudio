import { newId } from '@estudio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EstudioDb } from '@/db/schema';
import { ApiError, type ApiClient } from '@/lib/api';
import { AccountMismatchError, accountUserId, bindDeviceToAccount } from './commands';
import { login, refreshSession, setAuthClientForTests } from './session';
import { useAuth } from './store';

const T0 = Date.UTC(2026, 9, 20, 15); // QA1: reloj falso, nunca el real
const USER_A = newId();
const USER_B = newId();
const session = (userId: string) => ({
  userId,
  accessToken: `token-${userId}`,
  expiresAt: T0 + 900_000,
});

let database: EstudioDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  database = new EstudioDb(`auth-${newId()}`);
  useAuth.getState().signOut();
});

afterEach(async () => {
  vi.useRealTimers();
  await database.delete();
});

describe('cuenta del dispositivo', () => {
  it('liga los datos locales a la cuenta que entra', async () => {
    await bindDeviceToAccount(USER_A, database);
    expect(await accountUserId(database)).toBe(USER_A);
  });

  it('otra cuenta sin cambios pendientes: se borran los datos locales de la anterior', async () => {
    await bindDeviceToAccount(USER_A, database);
    await database.decks.add({
      id: newId(),
      name: 'De A',
      description: null,
      pausedAt: null,
      hlc: 'x',
      updatedAt: 1,
      deletedAt: null,
    });
    await database.meta.put({ key: 'syncCursor', value: '42' });
    await bindDeviceToAccount(USER_B, database);
    expect(await database.decks.count()).toBe(0);
    expect(await database.meta.get('syncCursor')).toBeUndefined();
    expect(await accountUserId(database)).toBe(USER_B);
  });

  it('otra cuenta con cambios sin enviar: se rechaza y no se borra nada', async () => {
    await bindDeviceToAccount(USER_A, database);
    await database.outbox.add({
      mutationId: newId(),
      op: 'upsert',
      entity: 'deck',
      row: {},
      createdAt: 1,
      attempts: 0,
      status: 'pending',
    });
    await expect(bindDeviceToAccount(USER_B, database)).rejects.toBeInstanceOf(AccountMismatchError);
    expect(await database.outbox.count()).toBe(1);
    expect(await accountUserId(database)).toBe(USER_A);
  });
});

describe('sesión', () => {
  it('login guarda el token solo en memoria y liga el dispositivo', async () => {
    setAuthClientForTests((() => Promise.resolve(session(USER_A))) as unknown as ApiClient);
    await login({ email: 'ella@ejemplo.mx', password: 'x'.repeat(12) }, database);
    expect(useAuth.getState().session?.userId).toBe(USER_A);
    expect(await accountUserId(database)).toBe(USER_A);
    expect(JSON.stringify(await database.meta.toArray())).not.toContain('token-');
  });

  it('refresh: ante el 409 de otra pestaña reintenta una vez; varias llamadas comparten un solo refresh', async () => {
    const calls = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'conflict'))
      .mockResolvedValueOnce(session(USER_A));
    setAuthClientForTests(calls);
    const [first, second] = await Promise.all([refreshSession(), refreshSession()]);
    expect([first, second]).toEqual(['ok', 'ok']);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(useAuth.getState().session?.userId).toBe(USER_A);
  });

  it('refresh sin red no cierra la sesión; un 401 sí', async () => {
    useAuth.getState().signIn(session(USER_A));
    setAuthClientForTests(() => Promise.reject(new ApiError(0, 'network')));
    expect(await refreshSession()).toBe('offline');
    expect(useAuth.getState().session).not.toBeNull();

    setAuthClientForTests(() => Promise.reject(new ApiError(401, 'unauthorized')));
    expect(await refreshSession()).toBe('signed_out');
    expect(useAuth.getState().session).toBeNull();
  });
});
