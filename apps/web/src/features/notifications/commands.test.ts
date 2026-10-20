import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { ApiError } from '@/lib/api';
import { reportOpened } from './commands';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth', () => ({ authorizedApi: api }));

const A = '0192f1a0-0000-7000-8000-0000000000a1';
const B = '0192f1a0-0000-7000-8000-0000000000a2';
const pending = async () => (await db.meta.get('notificationOpens'))?.value;

beforeEach(async () => {
  api.mockReset();
  await db.delete({ disableAutoOpen: false });
});

describe('NT7: reportar aperturas', () => {
  it('sin red la guarda y la reporta la próxima vez; un 404 se descarta', async () => {
    api.mockRejectedValue(new ApiError(0, 'network'));
    await reportOpened([A]);
    expect(await pending()).toEqual([A]);

    api.mockReset();
    api.mockImplementation((path: string) =>
      path.includes(B) ? Promise.reject(new ApiError(404, 'not_found')) : Promise.resolve(undefined),
    );
    await reportOpened([B]);
    expect(api.mock.calls.map((call) => String(call[0]))).toEqual([
      `/notifications/${A}/opened`,
      `/notifications/${B}/opened`,
    ]);
    expect(await pending()).toEqual([]);
  });
});
