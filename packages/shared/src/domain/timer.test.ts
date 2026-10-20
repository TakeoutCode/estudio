import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { TimerBlockLogSchema, TimerStateSchema } from './timer.js';

const T0 = 1_760_000_000_000;

const block = () => ({
  id: newId(),
  timerSessionId: newId(),
  deviceId: newId(),
  kind: 'focus',
  blockIndex: 0,
  mode: 'structured',
  startedAt: T0,
  endedAt: T0 + 25 * 60_000,
  plannedMs: 25 * 60_000,
  activeMs: 25 * 60_000,
  outcome: 'completed',
});

describe('temporizador (§3, SYNC SY7)', () => {
  it('acepta el estado inicial en reposo', () => {
    const idle = {
      state: 'idle',
      mode: 'flexible',
      startedAt: null,
      pausedAt: null,
      pausedMs: 0,
      blockIndex: 0,
      completedBlocks: 0,
      plannedMs: 0,
      extendedThisBlock: false,
      ownerDeviceId: newId(),
      lastSeenAt: null,
      endedReason: null,
    };
    expect(TimerStateSchema.safeParse(idle).success).toBe(true);
    expect(TimerStateSchema.safeParse({ ...idle, state: 'running' }).success).toBe(false);
    expect(TimerStateSchema.safeParse({ ...idle, pausedMs: -1 }).success).toBe(false);
  });

  it('un bloque cerrado no termina antes de empezar ni acepta campos de más', () => {
    expect(TimerBlockLogSchema.safeParse(block()).success).toBe(true);
    expect(TimerBlockLogSchema.safeParse({ ...block(), endedAt: T0 - 1 }).success).toBe(false);
    expect(TimerBlockLogSchema.safeParse({ ...block(), outcome: 'failed' }).success).toBe(false);
    expect(TimerBlockLogSchema.safeParse({ ...block(), streak: 3 }).success).toBe(false);
  });
});
