import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { SYNC_TIMING, SyncScheduler, type SyncState } from './scheduler';

const setup = (run: () => Promise<unknown>, overrides: { online?: boolean; session?: boolean } = {}) => {
  const states: SyncState[] = [];
  const scheduler = new SyncScheduler(run, {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    random: () => 1, // sin jitter: backoff exacto
    isOnline: () => overrides.online ?? true,
    hasSession: () => overrides.session ?? true,
    exclusive: (task) => task(),
    onState: (state) => states.push(state),
  });
  return { scheduler, states };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SyncScheduler (SYNC SY8)', () => {
  it('junta varias escrituras seguidas en una sola sync tras 2 s', async () => {
    const run = vi.fn(() => Promise.resolve());
    const { scheduler } = setup(run);
    scheduler.poke();
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.poke();
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.pokeDebounceMs - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ante fallos reintenta con backoff 1 s × 2ⁿ y respeta Retry-After', async () => {
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(503, 'unavailable'))
      .mockRejectedValueOnce(new ApiError(503, 'unavailable'))
      .mockRejectedValueOnce(new ApiError(429, 'rate_limited', 30_000))
      .mockResolvedValue(undefined);
    const { scheduler, states } = setup(run);
    scheduler.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(4);
    expect(states.at(-1)).toBe('idle');
  });

  it('el backoff no pasa de 5 min', async () => {
    const run = vi.fn(() => Promise.reject(new ApiError(503, 'unavailable')));
    const { scheduler } = setup(run);
    scheduler.now();
    for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(SYNC_TIMING.backoffMaxMs);
    const calls = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SYNC_TIMING.backoffMaxMs);
    expect(run.mock.calls.length).toBe(calls + 1);
  });

  it('401 o 426 pausan la sync hasta resume(); un poke no la despierta', async () => {
    for (const [code, state] of [
      ['unauthorized', 'signed_out'],
      ['contract_outdated', 'outdated'],
    ] as const) {
      const run = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new ApiError(0, code))
        .mockResolvedValue();
      const { scheduler, states } = setup(run);
      scheduler.now();
      await vi.advanceTimersByTimeAsync(0);
      expect(states.at(-1)).toBe(state);
      scheduler.poke();
      await vi.advanceTimersByTimeAsync(SYNC_TIMING.backoffMaxMs);
      expect(run).toHaveBeenCalledTimes(1);
      scheduler.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(run).toHaveBeenCalledTimes(2);
    }
  });

  it('sin sesión o sin red no intenta nada', async () => {
    const run = vi.fn(() => Promise.resolve());
    const signedOut = setup(run, { session: false });
    signedOut.scheduler.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(signedOut.states).toEqual(['signed_out']);
    const offline = setup(run, { online: false });
    offline.scheduler.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(offline.states).toEqual(['offline']);
    expect(run).not.toHaveBeenCalled();
  });

  it('una escritura durante una sync en curso dispara otra al terminar', async () => {
    let finish!: () => void;
    const run = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockResolvedValue();
    const { scheduler } = setup(run);
    scheduler.now();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
