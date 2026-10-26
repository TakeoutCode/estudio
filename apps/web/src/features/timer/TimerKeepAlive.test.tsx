import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { currentTimerSession, dispatchTimer } from './commands';
import { useTimerAway } from './store';
import { TimerKeepAlive } from './TimerKeepAlive';

const T0 = Date.UTC(2026, 9, 20, 15);
const MIN = 60_000;

const session = () => currentTimerSession(db);

/** Un minuto de reloj; el primer tick del minuto se guarda antes de seguir. */
async function minutePasses(minute: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(MIN);
  await vi.waitFor(async () => {
    expect((await session())?.lastSeenAt).toBeGreaterThan(T0 + (minute - 1) * MIN);
  });
}

beforeEach(async () => {
  // Solo el reloj y el intervalo de repintado: Dexie sigue con sus tareas reales.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  useTimerAway.getState().setAway(null);
  await dispatchTimer({ type: 'start' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerKeepAlive (STUDY-METHODS §3)', () => {
  it('fuera de la pantalla de estudio, con la app abierta, el bloque sigue aunque pasen 15 min', async () => {
    render(<TimerKeepAlive />);
    for (let minute = 1; minute <= 15; minute += 1) await minutePasses(minute);
    expect((await session())?.state).toBe('focus');
    expect(await db.timerBlockLogs.count()).toBe(0);
    expect(useTimerAway.getState().away).toBeNull();
  });

  it('§3: tras más de pauseTimeoutMin sin ticks (app cerrada), interrumpe y lo guarda para preguntar', async () => {
    const first = render(<TimerKeepAlive />);
    await minutePasses(1);
    first.unmount(); // la app se cerró
    vi.setSystemTime(T0 + 15 * MIN);
    render(<TimerKeepAlive />);
    await vi.waitFor(() => {
      expect(useTimerAway.getState().away?.interrupted).toMatchObject({ outcome: 'interrupted' });
    });
    expect((await session())?.state).toBe('idle');
  });
});
