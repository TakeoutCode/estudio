import { TimerConfigSchema, type TimerSession } from '@estudio/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { updateNotificationPrefs } from '@/features/settings';
import type { TimerView } from '@/features/timer';
import { useBreakEndNotice } from './use-break-end-notice';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), cancel: vi.fn() }));
vi.mock('./commands', () => ({ scheduleBreakEnd: mocks.schedule, cancelBreakEnd: mocks.cancel }));

const T = Date.UTC(2026, 9, 20, 18);
const MIN = 60_000;
const OFFSET = 1_000;
const SESSION_ID = '0192f1a0-0000-7000-8000-0000000000e1';

const session = (patch: Partial<TimerSession> = {}): TimerSession => ({
  id: SESSION_ID,
  hlc: '',
  updatedAt: T,
  deletedAt: null,
  state: 'break_short',
  mode: 'flexible',
  startedAt: T,
  pausedAt: null,
  pausedMs: 0,
  blockIndex: 1,
  completedBlocks: 1,
  plannedMs: 5 * MIN,
  extendedThisBlock: false,
  ownerDeviceId: '0192f1a0-0000-7000-8000-0000000000e2',
  lastSeenAt: null,
  endedReason: null,
  ...patch,
});
const view = (patch: Partial<TimerSession> = {}, isOwner = true): TimerView => ({
  session: session(patch),
  isOwner,
  offsetMs: OFFSET,
  config: TimerConfigSchema.parse({}),
});

let visibility: DocumentVisibilityState = 'visible';
const goTo = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T + MIN - OFFSET); // hora del servidor: 1 min dentro del descanso
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  mocks.schedule.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
  await updateNotificationPrefs((p) => ({ ...p, enabled: true }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.schedule.mockReset();
  mocks.cancel.mockReset();
  visibility = 'visible';
});

/** Espera a que la preferencia guardada llegue al hook (useLiveQuery es asíncrono). */
async function mounted(initial: TimerView) {
  const hook = renderHook(
    ({ v }) => {
      useBreakEndNotice(v);
    },
    { initialProps: { v: initial } },
  );
  await waitFor(() => {
    goTo('hidden');
    expect(mocks.schedule).toHaveBeenCalled();
  });
  goTo('visible');
  mocks.schedule.mockClear();
  mocks.cancel.mockClear();
  return hook;
}

describe('NT4, FE11: fin de descanso en segundo plano', () => {
  it('al salir programa la hora de fin (en hora del servidor); al volver la cancela (NT-T7)', async () => {
    await mounted(view());
    goTo('hidden');
    expect(mocks.schedule).toHaveBeenCalledWith({
      timerSessionId: SESSION_ID,
      blockIndex: 1,
      fireAt: T + 5 * MIN,
    });
    goTo('visible');
    expect(mocks.cancel).toHaveBeenCalledWith({ timerSessionId: SESSION_ID, blockIndex: 1 });
  });

  it('fuera de un descanso, en otro dispositivo o con el descanso ya terminado, no programa nada', async () => {
    const hook = await mounted(view());
    for (const v of [view({ state: 'focus' }), view({}, false), view({ startedAt: T - 10 * MIN })]) {
      hook.rerender({ v });
      goTo('hidden');
      goTo('visible');
    }
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('con el aviso de descanso apagado no programa nada', async () => {
    await updateNotificationPrefs((p) => ({ ...p, breakEnd: { enabled: false } }));
    renderHook(() => {
      useBreakEndNotice(view());
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    goTo('hidden');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
