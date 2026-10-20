import {
  newId,
  type TimerBlockLog,
  TimerBlockLogSchema,
  type TimerSession,
  TimerSessionSchema,
} from '@estudio/shared';
import {
  createTimer,
  manualBlock,
  type TimerBlockRecord,
  type TimerEvent,
  type TimerStep,
  transition,
} from '@estudio/srs';
import { deviceId, hlcWall, nextHlc, serverTime } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

type WithoutNow<T> = T extends unknown ? Omit<T, 'now'> : never;
/** Evento de la máquina sin su `now`: lo pone el comando, en hora del servidor (SY7). */
export type TimerAction =
  WithoutNow<Exclude<TimerEvent, { type: 'takeover' }>> | { readonly type: 'takeover' };

export interface TimerResult extends TimerStep {
  readonly sessionId: string;
}

const tables = (database: EstudioDb) => [
  database.timerSessions,
  database.timerBlockLogs,
  database.userSettings,
  database.outbox,
  database.meta,
];

/** La sesión vigente: la única viva que no terminó (SY7). Ante dos, la de HLC mayor. */
export async function currentTimerSession(database: EstudioDb): Promise<TimerSession | null> {
  const open = await database.timerSessions
    .filter((s) => s.deletedAt === null && s.state !== 'ended')
    .toArray();
  return open.sort((a, b) => (a.hlc < b.hlc ? 1 : -1))[0] ?? null;
}

/**
 * Aplica un evento con la máquina de `srs` (ARC2) y, en la misma transacción, escribe la
 * sesión, el bloque cerrado y sus entradas del outbox (FE3). Solo el dispositivo dueño mueve
 * el temporizador; desde otro, `start` y `takeover` toman el control primero (ADR-006).
 * Devuelve `null` si no hay nada que hacer.
 */
export async function dispatchTimer(
  action: TimerAction,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<TimerResult | null> {
  const result = await database.transaction('rw', tables(database), async () => {
    const at = await serverTime(database, now);
    const cfg = (await readStudyConfig(database)).timer;
    const device = await deviceId(database);
    const current = await currentTimerSession(database);
    if (!current && action.type !== 'start') return null;

    const session: TimerSession = current ?? {
      ...createTimer(cfg.mode, device),
      id: newId(),
      hlc: '',
      updatedAt: 0,
      deletedAt: null,
    };
    let state: TimerSession = session;
    let pending: TimerStep | null = null;
    if (session.ownerDeviceId !== device) {
      if (action.type !== 'start' && action.type !== 'takeover') return null;
      pending = transition(state, { type: 'takeover', now: at, deviceId: device }, cfg);
      if (pending.error) return null;
      state = { ...state, ...pending.timer };
    }
    const step: TimerStep =
      action.type === 'takeover'
        ? (pending ?? transition(state, { type: 'takeover', now: at, deviceId: device }, cfg))
        : transition(state, { ...action, now: at }, cfg);
    if (step.error) return { ...step, sessionId: session.id };

    const changed = step.changed || (pending?.changed ?? false) || !current;
    if (changed) {
      const hlc = await nextHlc(database, now);
      const row = TimerSessionSchema.parse({ ...session, ...step.timer, hlc, updatedAt: hlcWall(hlc) });
      await writeAndQueue(database, 'timerSession', row, now);
    } else if (step.timer.lastSeenAt !== session.lastSeenAt) {
      // Latido local, sin outbox: detecta la app cerrada a mitad de bloque tras recargar (§3).
      await database.timerSessions.update(session.id, { lastSeenAt: step.timer.lastSeenAt });
    }
    for (const record of [pending?.closed, step.closed]) {
      if (record) await appendBlock(database, session.id, device, record, now);
    }
    return { ...step, changed, closed: step.closed ?? pending?.closed ?? null, sessionId: session.id };
  });
  if (result?.changed) syncScheduler.poke();
  return result;
}

/** §3: "Sí, X min" tras una interrupción. Se guarda aparte como `manual`, sin mezclarse. */
export async function recordManualMinutes(
  input: { readonly sessionId: string; readonly interrupted: TimerBlockRecord; readonly minutes: number },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<TimerBlockLog> {
  const log = await database.transaction('rw', tables(database), async () => {
    const at = await serverTime(database, now);
    const record = manualBlock(input.interrupted, input.minutes, at);
    return appendBlock(database, input.sessionId, await deviceId(database), record, now);
  });
  syncScheduler.poke();
  return log;
}

async function appendBlock(
  database: EstudioDb,
  timerSessionId: string,
  device: string,
  record: TimerBlockRecord,
  now: number,
): Promise<TimerBlockLog> {
  const log = TimerBlockLogSchema.parse({ id: newId(), timerSessionId, deviceId: device, ...record });
  await writeAndQueue(database, 'timerBlockLog', log, now);
  return log;
}
