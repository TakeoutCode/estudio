import type {
  TimerBlockLog,
  TimerConfig,
  TimerEndedReason,
  TimerMode,
  TimerPhase,
  TimerState,
} from '@estudio/shared';

// Máquina del temporizador (STUDY-METHODS §3, R7, R8, R13; QUALITY QA2). Pura: cada evento
// trae su `now` (AGENTS AG3) y el tiempo sale de marcas, nunca de acumular ticks.
//
// Reloj: cada evento usa `max(now, lastSeenAt)`, así un reloj que retrocede no devuelve
// tiempo ni vuelve negativo nada. La app despacha `tick` cada segundo con la pantalla
// visible y al volver a primer plano: un hueco mayor que `pauseTimeoutMin` desde el último
// evento significa que la app estuvo cerrada o en segundo plano (§3, "cierre a mitad").

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

export type TimerEvent =
  | { readonly type: 'start'; readonly now: number }
  | { readonly type: 'pause'; readonly now: number }
  | { readonly type: 'resume'; readonly now: number }
  /** `cardInProgress`: hay una tarjeta a medio responder (R13). */
  | { readonly type: 'tick'; readonly now: number; readonly cardInProgress?: boolean }
  | { readonly type: 'cardDone'; readonly now: number }
  | { readonly type: 'extend'; readonly now: number }
  /** Ella pide descanso: fin de bloque en flexible y libre, o acepta la sugerencia de P5. */
  | { readonly type: 'takeBreak'; readonly now: number }
  /** Termina el descanso (antes o después de tiempo) y empieza el bloque siguiente. */
  | { readonly type: 'skipBreak'; readonly now: number }
  | { readonly type: 'stop'; readonly now: number; readonly reason?: TimerEndedReason }
  /** "Continuar aquí" desde otro dispositivo (ADR-006). */
  | { readonly type: 'takeover'; readonly now: number; readonly deviceId: string };

export type TimerEventType = TimerEvent['type'];

export type TimerErrorCode = 'invalid_transition' | 'extend_unavailable' | 'pause_not_expired';

export interface TimerError {
  readonly code: TimerErrorCode;
  readonly state: TimerPhase;
  readonly event: TimerEventType;
}

/** Bloque o descanso cerrado; quien persiste agrega `id`, `timerSessionId` y `deviceId`. */
export type TimerBlockRecord = Omit<TimerBlockLog, 'id' | 'timerSessionId' | 'deviceId'>;

/** La app estuvo fuera más de `pauseTimeoutMin`: preguntar si siguió estudiando (§3). */
export type TimerNotice = 'interrupted_while_away';

export interface TimerStep {
  readonly timer: TimerState;
  readonly error: TimerError | null;
  readonly closed: TimerBlockRecord | null;
  readonly notice: TimerNotice | null;
  /** `false` si solo avanzó `lastSeenAt`: no hace falta escribir ni sincronizar (SYNC SY7). */
  readonly changed: boolean;
}

/** Sesión nueva en reposo. El modo queda fijo para toda la sesión. */
export function createTimer(mode: TimerMode, ownerDeviceId: string): TimerState {
  return {
    state: 'idle',
    mode,
    startedAt: null,
    pausedAt: null,
    pausedMs: 0,
    blockIndex: 0,
    completedBlocks: 0,
    plannedMs: 0,
    extendedThisBlock: false,
    ownerDeviceId,
    lastSeenAt: null,
    endedReason: null,
  };
}

const clock = (t: TimerState, now: number): number => Math.max(now, t.lastSeenAt ?? now);

const inBlock = (t: TimerState): boolean => t.state === 'focus' || t.state === 'paused';
const inBreak = (t: TimerState): boolean => t.state === 'break_short' || t.state === 'break_long';

const activeUntil = (t: TimerState, end: number): number =>
  t.startedAt === null ? 0 : Math.max(0, (t.pausedAt ?? end) - t.startedAt - t.pausedMs);

/** Tiempo activo del bloque en curso: congelado en pausa (§3) y nunca decreciente. */
export function activeMs(t: TimerState, now: number): number {
  return inBlock(t) ? activeUntil(t, clock(t, now)) : 0;
}

/** Tiempo transcurrido del descanso en curso. */
export function breakElapsedMs(t: TimerState, now: number): number {
  return inBreak(t) && t.startedAt !== null ? clock(t, now) - t.startedAt : 0;
}

/** Tiempo restante del bloque o descanso; 0 fuera de ellos y nunca negativo. */
export function remainingMs(t: TimerState, now: number): number {
  if (inBlock(t)) return Math.max(0, t.plannedMs - activeMs(t, now));
  if (inBreak(t)) return Math.max(0, t.plannedMs - breakElapsedMs(t, now));
  return 0;
}

/** La pausa pasó `pauseTimeoutMin`: la UI ofrece "Reanudar" (`resume`) o "Bloque nuevo" (`start`). */
export function isPauseExpired(
  t: TimerState,
  now: number,
  cfg: Pick<TimerConfig, 'pauseTimeoutMin'>,
): boolean {
  return (
    t.state === 'paused' &&
    t.pausedAt !== null &&
    clock(t, now) - t.pausedAt > cfg.pauseTimeoutMin * MINUTE_MS
  );
}

/**
 * Aplica un evento. Una transición inválida devuelve el mismo estado (misma referencia) y
 * un error tipado (QA2).
 */
export function transition(t: TimerState, event: TimerEvent, cfg: TimerConfig): TimerStep {
  if (t.state === 'ended') return event.type === 'tick' ? step(t, t) : fail(t, event, 'invalid_transition');
  const now = clock(t, event.now);
  const seen: TimerState = { ...t, lastSeenAt: now };

  switch (event.type) {
    case 'tick':
      return onTick(t, seen, now, cfg, event.cardInProgress ?? false);
    case 'takeover': {
      // El otro dispositivo pudo quedar cerrado: primero se aplica la ausencia, como en `tick`.
      const away = wasAway(t, now, cfg) ? interruptAway(t, seen) : null;
      const next: TimerState = { ...(away?.timer ?? seen), ownerDeviceId: event.deviceId };
      return { ...step(t, next, away?.closed ?? null), notice: away?.notice ?? null };
    }
    case 'stop': {
      const ended = (base: TimerState): TimerState => ({
        ...base,
        state: 'ended',
        startedAt: null,
        plannedMs: 0,
        endedReason: event.reason ?? 'user',
      });
      if (inBlock(t)) {
        const { base, record } = closeBlock(seen, now, isPauseExpired(t, now, cfg));
        return step(t, ended(base), record);
      }
      if (inBreak(t)) {
        const { base, record } = closeBreak(seen, now);
        return step(t, ended(base), record);
      }
      return step(t, ended(seen));
    }
    case 'start': {
      if (t.state === 'idle') return step(t, startFocus(seen, now, cfg.focusMin * MINUTE_MS));
      if (t.state !== 'paused') return fail(t, event, 'invalid_transition');
      if (!isPauseExpired(t, now, cfg)) return fail(t, event, 'pause_not_expired');
      // "Bloque nuevo" (§3): el bloque viejo queda interrumpido.
      const { base, record } = closeBlock(seen, now, true);
      return step(t, startFocus(base, now, cfg.focusMin * MINUTE_MS), record);
    }
    case 'pause':
      return t.state === 'focus'
        ? step(t, { ...seen, state: 'paused', pausedAt: now })
        : fail(t, event, 'invalid_transition');
    case 'resume': {
      if (t.state !== 'paused' || t.pausedAt === null) return fail(t, event, 'invalid_transition');
      if (!isPauseExpired(t, now, cfg)) {
        return step(t, {
          ...seen,
          state: 'focus',
          pausedAt: null,
          pausedMs: t.pausedMs + (now - t.pausedAt),
        });
      }
      // "Reanudar" tras el límite (§3): el bloque viejo cuenta solo su tiempo activo y no
      // completa ciclo; el tiempo que le faltaba pasa a un bloque nuevo.
      const left = t.plannedMs - activeUntil(t, now);
      const { base, record } = closeBlock(seen, now, true);
      return step(t, startFocus(base, now, left > 0 ? left : cfg.focusMin * MINUTE_MS), record);
    }
    case 'cardDone':
      if (t.state === 'focus') {
        // R13: en estructurado, el bloque que ya llegó a 0 cierra al terminar la tarjeta.
        return t.mode === 'structured' && remainingMs(t, now) === 0
          ? toBreak(t, seen, now, cfg, false)
          : step(t, seen);
      }
      // Tarjeta que terminó ya en pausa o en descanso (tras la gracia de R13): nada que cambiar.
      return t.state === 'idle' ? fail(t, event, 'invalid_transition') : step(t, seen);
    case 'extend':
      if (t.state !== 'focus') return fail(t, event, 'invalid_transition');
      if (t.mode !== 'flexible' || t.extendedThisBlock) return fail(t, event, 'extend_unavailable');
      return step(t, {
        ...seen,
        plannedMs: t.plannedMs + cfg.flexExtendMin * MINUTE_MS,
        extendedThisBlock: true,
      });
    case 'takeBreak':
      return inBlock(t)
        ? toBreak(t, seen, now, cfg, isPauseExpired(t, now, cfg))
        : fail(t, event, 'invalid_transition');
    case 'skipBreak': {
      if (!inBreak(t)) return fail(t, event, 'invalid_transition');
      const { base, record } = closeBreak(seen, now);
      return step(t, startFocus(base, now, cfg.focusMin * MINUTE_MS), record);
    }
  }
}

function onTick(
  t: TimerState,
  seen: TimerState,
  now: number,
  cfg: TimerConfig,
  cardInProgress: boolean,
): TimerStep {
  if (t.state !== 'focus') return step(t, seen);
  if (wasAway(t, now, cfg)) return interruptAway(t, seen);
  if (t.mode !== 'structured' || remainingMs(t, now) > 0) return step(t, seen);
  // §3 y R13: al llegar a 0 espera la tarjeta en curso hasta `endOfBlockGraceSec`.
  const overtime = activeUntil(t, now) - t.plannedMs;
  return cardInProgress && overtime < cfg.endOfBlockGraceSec * SECOND_MS
    ? step(t, seen)
    : toBreak(t, seen, now, cfg, false);
}

const wasAway = (t: TimerState, now: number, cfg: Pick<TimerConfig, 'pauseTimeoutMin'>): boolean =>
  t.state === 'focus' && t.lastSeenAt !== null && now - t.lastSeenAt > cfg.pauseTimeoutMin * MINUTE_MS;

/** Solo se llama con `wasAway`: el bloque cuenta hasta el último momento en que la app estuvo viva. */
function interruptAway(t: TimerState, seen: TimerState): TimerStep {
  const lastAlive = t.lastSeenAt ?? 0;
  const { base, record } = closeBlock(seen, lastAlive, true);
  const idle: TimerState = { ...base, state: 'idle', startedAt: null, plannedMs: 0 };
  return { ...step(t, idle, record), notice: 'interrupted_while_away' };
}

/**
 * Cierra el bloque en curso. `forced` (pausa o ausencia mayor que el límite) siempre es
 * `interrupted` (QA2). Si lo cierra ella: `completed` al llegar a lo planeado, o siempre
 * en modo libre, donde no hay plan que cumplir (§3).
 */
function closeBlock(
  t: TimerState,
  end: number,
  forced: boolean,
): { base: TimerState; record: TimerBlockRecord } {
  const active = activeUntil(t, end);
  const completed = !forced && (t.mode === 'free' || active >= t.plannedMs);
  const record: TimerBlockRecord = {
    kind: 'focus',
    blockIndex: t.blockIndex,
    mode: t.mode,
    startedAt: t.startedAt ?? end,
    endedAt: end,
    plannedMs: t.plannedMs,
    activeMs: active,
    outcome: completed ? 'completed' : 'interrupted',
  };
  const base: TimerState = {
    ...t,
    blockIndex: t.blockIndex + 1,
    completedBlocks: t.completedBlocks + (completed ? 1 : 0),
    pausedAt: null,
    pausedMs: 0,
    extendedThisBlock: false,
  };
  return { base, record };
}

function closeBreak(t: TimerState, end: number): { base: TimerState; record: TimerBlockRecord } {
  const startedAt = t.startedAt ?? end;
  const record: TimerBlockRecord = {
    kind: t.state === 'break_long' ? 'break_long' : 'break_short',
    blockIndex: Math.max(0, t.blockIndex - 1), // el bloque al que sigue
    mode: t.mode,
    startedAt,
    endedAt: end,
    plannedMs: t.plannedMs,
    activeMs: end - startedAt,
    outcome: end - startedAt >= t.plannedMs ? 'completed' : 'interrupted',
  };
  return { base: t, record };
}

/** Cierra el bloque y abre el descanso: largo tras `cyclesBeforeLong` bloques completados (R7). */
function toBreak(t: TimerState, seen: TimerState, now: number, cfg: TimerConfig, forced: boolean): TimerStep {
  const { base, record } = closeBlock(seen, now, forced);
  const long = record.outcome === 'completed' && base.completedBlocks % cfg.cyclesBeforeLong === 0;
  const next: TimerState = {
    ...base,
    state: long ? 'break_long' : 'break_short',
    startedAt: now,
    plannedMs: (long ? cfg.longBreakMin : cfg.shortBreakMin) * MINUTE_MS,
  };
  return step(t, next, record);
}

function startFocus(base: TimerState, now: number, plannedMs: number): TimerState {
  return {
    ...base,
    state: 'focus',
    startedAt: now,
    plannedMs,
    pausedAt: null,
    pausedMs: 0,
    extendedThisBlock: false,
  };
}

function step(prev: TimerState, next: TimerState, closed: TimerBlockRecord | null = null): TimerStep {
  const keys = Object.keys(next) as (keyof TimerState)[];
  const changed = closed !== null || keys.some((key) => key !== 'lastSeenAt' && next[key] !== prev[key]);
  return { timer: next, error: null, closed, notice: null, changed };
}

function fail(t: TimerState, event: TimerEvent, code: TimerErrorCode): TimerStep {
  return {
    timer: t,
    error: { code, state: t.state, event: event.type },
    closed: null,
    notice: null,
    changed: false,
  };
}

/** Tiempo declarado fuera de la app tras una interrupción (§3): se guarda como `manual`. */
export function manualBlock(interrupted: TimerBlockRecord, minutes: number, now: number): TimerBlockRecord {
  const ms = minutes * MINUTE_MS;
  if (!Number.isInteger(minutes) || minutes <= 0 || interrupted.endedAt + ms > now) {
    throw new RangeError('manual_minutes_out_of_range');
  }
  return {
    ...interrupted,
    startedAt: interrupted.endedAt,
    endedAt: interrupted.endedAt + ms,
    plannedMs: 0,
    activeMs: ms,
    outcome: 'manual',
  };
}
