import { newId } from '@estudio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EstudioDb } from '@/db/schema';
import { ApiError } from '@/lib/api';
import { accountUserId, bindDeviceToAccount } from './commands';
import { deleteAccount } from './session';
import { useAuth } from './store';

const USER = newId();

let database: EstudioDb;

const respond = (status: number, body?: unknown) =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(
      body === undefined
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/problem+json' },
          }),
    ),
  );

/** Una cuenta con un mazo y un cambio sin enviar en este dispositivo. */
async function seed() {
  await bindDeviceToAccount(USER, database);
  const deck = {
    id: newId(),
    name: 'Carpo',
    description: null,
    pausedAt: null,
    hlc: 'h',
    updatedAt: 1,
    deletedAt: null,
  };
  await database.decks.add(deck);
  await database.outbox.add({
    mutationId: newId(),
    op: 'upsert',
    entity: 'deck',
    row: deck,
    createdAt: 1,
    attempts: 0,
    status: 'pending',
  });
}

beforeEach(() => {
  database = new EstudioDb(`borrar-${newId()}`);
  useAuth.getState().signIn({ userId: USER, accessToken: 'token', expiresAt: Date.now() + 900_000 });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await database.delete();
});

describe('borrar la cuenta (QUALITY QA6)', () => {
  it('con la contraseña, pide DELETE /me y deja el dispositivo sin nada de ella', async () => {
    await seed();
    const fetch = respond(204);
    vi.stubGlobal('fetch', fetch);

    await deleteAccount('una-contraseña-larga', database);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(typeof url === 'string' ? url : '').toMatch(/\/me$/);
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '{}')).toEqual({
      password: 'una-contraseña-larga',
    });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token');
    for (const table of database.tables) expect(await table.count()).toBe(0);
    expect(await accountUserId(database)).toBeNull();
    expect(useAuth.getState().session).toBeNull();
  });

  it('con otra contraseña o sin red falla y no toca nada', async () => {
    await seed();
    vi.stubGlobal('fetch', respond(403, { type: 'about:blank', title: 'x', status: 403, code: 'forbidden' }));
    await expect(deleteAccount('otra', database)).rejects.toMatchObject({ code: 'forbidden' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(deleteAccount('una-contraseña-larga', database)).rejects.toBeInstanceOf(ApiError);

    expect(await database.decks.count()).toBe(1);
    expect(await database.outbox.count()).toBe(1);
    expect(await accountUserId(database)).toBe(USER);
    expect(useAuth.getState().session).not.toBeNull();
  });
});
