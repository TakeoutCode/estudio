import { defaultStudyConfig, encodeHlc, MutationSchema, newId, type TimerSession } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { deviceId } from '@/db/clock';
import { db, SERVER_OFFSET_KEY } from '@/db/schema';
import { updateStudyConfig } from '@/features/settings';
import { currentTimerSession, dispatchTimer, recordManualMinutes } from './commands';

const T0 = Date.UTC(2026, 9, 20, 15);
const MIN = 60_000;
const OTHER_DEVICE = '0192f1a0-0000-7000-8000-0000000000ee';
const cfg = defaultStudyConfig().timer;

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

const outbox = async () => (await db.outbox.orderBy('mutationId').toArray()).map((e) => e.entity);
const at = (minutes: number) => ({ now: T0 + minutes * MIN });

describe('dispatchTimer (SYNC SY7, §3)', () => {
  it('empezar crea la sesión de este dispositivo, en hora del servidor y con su outbox', async () => {
    await db.meta.put({ key: SERVER_OFFSET_KEY, value: 5_000 });
    const result = await dispatchTimer({ type: 'start' }, at(0));
    const session = await currentTimerSession(db);
    expect(result?.error).toBeNull();
    expect(session).toMatchObject({
      state: 'focus',
      mode: cfg.mode,
      startedAt: T0 + 5_000,
      plannedMs: cfg.focusMin * MIN,
      ownerDeviceId: await db.transaction('rw', db.meta, () => deviceId(db)),
    });
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ entity: 'timerSession', op: 'upsert', row: session });
    expect(MutationSchema.safeParse(entry).success).toBe(true);
  });

  it('un tick sin transición no sincroniza, pero guarda el latido en local', async () => {
    await dispatchTimer({ type: 'start' }, at(0));
    await db.outbox.clear();
    await dispatchTimer({ type: 'tick', cardInProgress: false }, at(3));
    expect(await db.outbox.count()).toBe(0);
    expect((await currentTimerSession(db))?.lastSeenAt).toBe(T0 + 3 * MIN);
  });

  it('pedir descanso cierra el bloque: sesión y TimerBlockLog en el mismo outbox', async () => {
    await dispatchTimer({ type: 'start' }, at(0));
    await db.outbox.clear();
    const result = await dispatchTimer({ type: 'takeBreak' }, at(4));
    expect(result?.closed).toMatchObject({ kind: 'focus', activeMs: 4 * MIN, outcome: 'interrupted' });
    expect((await currentTimerSession(db))?.state).toBe('break_short');
    expect(await outbox()).toEqual(['timerSession', 'timerBlockLog']);
    const [block] = await db.timerBlockLogs.toArray();
    expect(block).toMatchObject({ timerSessionId: result?.sessionId, outcome: 'interrupted' });
  });

  it('§3: al volver tras más del límite, el bloque se interrumpe y lo declarado queda como manual', async () => {
    await dispatchTimer({ type: 'start' }, at(0));
    await dispatchTimer({ type: 'tick', cardInProgress: false }, at(2));
    const back = await dispatchTimer(
      { type: 'tick', cardInProgress: false },
      at(2 + cfg.pauseTimeoutMin + 5),
    );
    expect(back?.notice).toBe('interrupted_while_away');
    expect((await currentTimerSession(db))?.state).toBe('idle');
    const manual = await recordManualMinutes(
      { sessionId: back!.sessionId, interrupted: back!.closed!, minutes: 10 },
      at(2 + cfg.pauseTimeoutMin + 6),
    );
    expect(manual).toMatchObject({ outcome: 'manual', activeMs: 10 * MIN });
    expect((await db.timerBlockLogs.toArray()).map((b) => b.outcome).sort()).toEqual([
      'interrupted',
      'manual',
    ]);
    await expect(
      recordManualMinutes({ sessionId: back!.sessionId, interrupted: back!.closed!, minutes: 90 }, at(20)),
    ).rejects.toThrow('manual_minutes_out_of_range');
  });

  it('ADR-006: desde otro dispositivo solo se puede tomar el control', async () => {
    const foreign: TimerSession = {
      id: newId(),
      hlc: encodeHlc({ wall: T0, counter: 0, node: OTHER_DEVICE }),
      updatedAt: T0,
      deletedAt: null,
      state: 'focus',
      mode: 'flexible',
      startedAt: T0,
      pausedAt: null,
      pausedMs: 0,
      blockIndex: 0,
      completedBlocks: 0,
      plannedMs: cfg.focusMin * MIN,
      extendedThisBlock: false,
      ownerDeviceId: OTHER_DEVICE,
      lastSeenAt: T0 + MIN,
      endedReason: null,
    };
    await db.timerSessions.put(foreign);
    expect(await dispatchTimer({ type: 'pause' }, at(2))).toBeNull();
    expect(await dispatchTimer({ type: 'tick', cardInProgress: false }, at(2))).toBeNull();
    const taken = await dispatchTimer({ type: 'takeover' }, at(3));
    expect(taken?.changed).toBe(true);
    const mine = await currentTimerSession(db);
    expect(mine).toMatchObject({ id: foreign.id, state: 'focus' });
    expect(mine?.ownerDeviceId).not.toBe(OTHER_DEVICE);
    expect(await dispatchTimer({ type: 'pause' }, at(4))).toMatchObject({ error: null });
  });

  it('terminar cierra la sesión; empezar otra vez crea una nueva', async () => {
    const first = await dispatchTimer({ type: 'start' }, at(0));
    await dispatchTimer({ type: 'stop' }, at(1));
    expect(await currentTimerSession(db)).toBeNull();
    expect(await dispatchTimer({ type: 'pause' }, at(2))).toBeNull();
    const second = await dispatchTimer({ type: 'start' }, at(3));
    expect(second?.sessionId).not.toBe(first?.sessionId);
  });

  it('R7, R8: el modo y el ritmo elegidos se guardan en UserSettings y los usa el bloque nuevo', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await updateStudyConfig(
      (c) => ({ ...c, timer: { ...c.timer, mode: 'structured', focusMin: 50, shortBreakMin: 10 } }),
      at(0),
    );
    await dispatchTimer({ type: 'start' }, at(1));
    expect(await currentTimerSession(db)).toMatchObject({ mode: 'structured', plannedMs: 50 * MIN });
    expect(await outbox()).toEqual(['userSettings', 'timerSession']);
    await expect(
      updateStudyConfig((c) => ({ ...c, timer: { ...c.timer, focusMin: 500 } })),
    ).rejects.toThrow();
  });
});
