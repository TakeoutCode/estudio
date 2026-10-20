import { defaultStudyConfig, type TimerConfig, type TimerMode, type TimerPhase } from '@estudio/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  activeMs,
  breakElapsedMs,
  createTimer,
  isPauseExpired,
  manualBlock,
  remainingMs,
  type TimerBlockRecord,
  type TimerEvent,
  type TimerEventType,
  type TimerStep,
  transition,
} from './machine.js';

const MIN = 60_000;
const DEVICE = '0192f1a0-0000-7000-8000-0000000000d1';
const OTHER_DEVICE = '0192f1a0-0000-7000-8000-0000000000d2';
const T0 = Date.UTC(2026, 9, 20, 15);
const base = defaultStudyConfig().timer;
const cfgWith = (patch: Partial<TimerConfig>): TimerConfig => ({ ...base, ...patch });

const at = (minutes: number) => T0 + minutes * MIN;
const start = (m: number): TimerEvent => ({ type: 'start', now: at(m) });
const pause = (m: number): TimerEvent => ({ type: 'pause', now: at(m) });
const resume = (m: number): TimerEvent => ({ type: 'resume', now: at(m) });
const tick = (m: number, cardInProgress = false): TimerEvent => ({
  type: 'tick',
  now: at(m),
  cardInProgress,
});
const cardDone = (m: number): TimerEvent => ({ type: 'cardDone', now: at(m) });
const extend = (m: number): TimerEvent => ({ type: 'extend', now: at(m) });
const takeBreak = (m: number): TimerEvent => ({ type: 'takeBreak', now: at(m) });
const skipBreak = (m: number): TimerEvent => ({ type: 'skipBreak', now: at(m) });
const stop = (m: number): TimerEvent => ({ type: 'stop', now: at(m) });
const takeover = (m: number): TimerEvent => ({ type: 'takeover', now: at(m), deviceId: OTHER_DEVICE });
/** Un tick por minuto hasta `to`, como la app con la pantalla visible. */
const ticksTo = (from: number, to: number, cardInProgress = false): TimerEvent[] =>
  Array.from({ length: Math.ceil(to - from) }, (_, i) => tick(Math.min(from + i + 1, to), cardInProgress));

interface Run extends TimerStep {
  readonly blocks: readonly TimerBlockRecord[];
  readonly lastBlock: TimerBlockRecord | undefined;
}

/** Aplica la secuencia y junta los bloques cerrados; falla si algún paso da error. */
function run(cfg: TimerConfig, events: readonly TimerEvent[], mode: TimerMode = cfg.mode): Run {
  let current: TimerStep = {
    timer: createTimer(mode, DEVICE),
    error: null,
    closed: null,
    notice: null,
    changed: false,
  };
  const blocks: TimerBlockRecord[] = [];
  for (const event of events) {
    current = transition(current.timer, event, cfg);
    if (current.error) throw new Error(`${current.error.code} en ${event.type} desde ${current.error.state}`);
    if (current.closed) blocks.push(current.closed);
  }
  return { ...current, blocks, lastBlock: blocks.at(-1) };
}

describe('temporizador · tabla estado × evento (QA2)', () => {
  const twoCycles = cfgWith({ mode: 'structured', cyclesBeforeLong: 2 });
  const reach: Record<TimerPhase, readonly TimerEvent[]> = {
    idle: [],
    focus: [start(0)],
    paused: [start(0), pause(5)],
    break_short: [start(0), ...ticksTo(0, 25)],
    break_long: [start(0), ...ticksTo(0, 25), skipBreak(30), ...ticksTo(30, 55)],
    ended: [start(0), stop(5)],
  };
  const events: Record<TimerEventType, (m: number) => TimerEvent> = {
    start,
    pause,
    resume,
    tick,
    cardDone,
    extend,
    takeBreak,
    skipBreak,
    stop,
    takeover,
  };
  // Destino esperado o código de error. El evento llega 1 min después del último paso.
  const table: Record<TimerPhase, Record<TimerEventType, TimerPhase | `!${string}`>> = {
    idle: {
      start: 'focus',
      pause: '!invalid_transition',
      resume: '!invalid_transition',
      tick: 'idle',
      cardDone: '!invalid_transition',
      extend: '!invalid_transition',
      takeBreak: '!invalid_transition',
      skipBreak: '!invalid_transition',
      stop: 'ended',
      takeover: 'idle',
    },
    focus: {
      start: '!invalid_transition',
      pause: 'paused',
      resume: '!invalid_transition',
      tick: 'focus',
      cardDone: 'focus',
      extend: '!extend_unavailable',
      takeBreak: 'break_short',
      skipBreak: '!invalid_transition',
      stop: 'ended',
      takeover: 'focus',
    },
    paused: {
      start: '!pause_not_expired',
      pause: '!invalid_transition',
      resume: 'focus',
      tick: 'paused',
      cardDone: 'paused',
      extend: '!invalid_transition',
      takeBreak: 'break_short',
      skipBreak: '!invalid_transition',
      stop: 'ended',
      takeover: 'paused',
    },
    break_short: {
      start: '!invalid_transition',
      pause: '!invalid_transition',
      resume: '!invalid_transition',
      tick: 'break_short',
      cardDone: 'break_short',
      extend: '!invalid_transition',
      takeBreak: '!invalid_transition',
      skipBreak: 'focus',
      stop: 'ended',
      takeover: 'break_short',
    },
    break_long: {
      start: '!invalid_transition',
      pause: '!invalid_transition',
      resume: '!invalid_transition',
      tick: 'break_long',
      cardDone: 'break_long',
      extend: '!invalid_transition',
      takeBreak: '!invalid_transition',
      skipBreak: 'focus',
      stop: 'ended',
      takeover: 'break_long',
    },
    ended: {
      start: '!invalid_transition',
      pause: '!invalid_transition',
      resume: '!invalid_transition',
      tick: 'ended',
      cardDone: '!invalid_transition',
      extend: '!invalid_transition',
      takeBreak: '!invalid_transition',
      skipBreak: '!invalid_transition',
      stop: '!invalid_transition',
      takeover: '!invalid_transition',
    },
  };
  const cells = Object.entries(table).flatMap(([state, row]) =>
    Object.entries(row).map(([event, expected]) => [state, event, expected] as const),
  );

  it.each(cells)('%s + %s → %s', (state, event, expected) => {
    const before = run(twoCycles, reach[state as TimerPhase]);
    expect(before.timer.state).toBe(state);
    const lastNow = before.timer.lastSeenAt ?? T0;
    const result = transition(
      before.timer,
      events[event as TimerEventType]((lastNow - T0) / MIN + 1),
      twoCycles,
    );
    // Inválida: mismo estado (misma referencia), error tipado y nada que guardar.
    const summary = result.error
      ? {
          to: `!${result.error.code}`,
          ...result.error,
          same: result.timer === before.timer,
          changed: result.changed,
        }
      : { to: result.timer.state };
    const invalid = { to: expected, code: expected.slice(1), state, event, same: true, changed: false };
    expect(summary).toEqual(expected.startsWith('!') ? invalid : { to: expected });
  });
});

describe('temporizador · pausa y reanudación (§3)', () => {
  const cfg = cfgWith({ mode: 'structured' });

  it('§3: pausa > pauseTimeout marca interrumpido', () => {
    const s = run(cfg, [start(0), pause(1), { type: 'resume', now: at(1) + cfg.pauseTimeoutMin * MIN + 1 }]);
    expect(s.lastBlock?.outcome).toBe('interrupted');
    expect(s.lastBlock?.activeMs).toBe(1 * MIN);
    expect(s.timer.completedBlocks).toBe(0); // no completa ciclo
  });

  it('§3: "Reanudar" tras el límite sigue con lo que faltaba en un bloque nuevo', () => {
    const s = run(cfg, [start(0), pause(10), resume(10 + cfg.pauseTimeoutMin + 1)]);
    expect(s.timer).toMatchObject({ state: 'focus', blockIndex: 1, plannedMs: (cfg.focusMin - 10) * MIN });
  });

  it('§3: "Bloque nuevo" tras el límite empieza con el enfoque completo', () => {
    const s = run(cfg, [start(0), pause(10), start(10 + cfg.pauseTimeoutMin + 1)]);
    expect(s.lastBlock?.outcome).toBe('interrupted');
    expect(s.timer).toMatchObject({ state: 'focus', blockIndex: 1, plannedMs: cfg.focusMin * MIN });
  });

  it('§3: "Reanudar" de un bloque ya cumplido empieza uno completo', () => {
    const flex = cfgWith({ mode: 'flexible' });
    const s = run(flex, [start(0), ...ticksTo(0, 30), pause(30), resume(30 + flex.pauseTimeoutMin + 1)]);
    expect(s.timer.plannedMs).toBe(flex.focusMin * MIN);
  });

  it('§3: pausar congela el reloj y la pausa no cuenta como tiempo activo', () => {
    const s = run(cfg, [start(0), pause(5), resume(8)]);
    expect(s.timer.state).toBe('focus');
    expect(activeMs(s.timer, at(10))).toBe(7 * MIN);
    expect(remainingMs(s.timer, at(10))).toBe((cfg.focusMin - 7) * MIN);
    const paused = run(cfg, [start(0), pause(5)]).timer;
    expect(activeMs(paused, at(9))).toBe(5 * MIN);
  });

  it('AG4: el límite de pausa sale de la config', () => {
    const events = [start(0), pause(1), resume(1 + 7)];
    expect(run(cfgWith({ pauseTimeoutMin: 10 }), events).lastBlock).toBeUndefined();
    expect(run(cfgWith({ pauseTimeoutMin: 5 }), events).lastBlock?.outcome).toBe('interrupted');
  });

  it('isPauseExpired solo es cierto en pausa y pasado el límite', () => {
    const paused = run(cfg, [start(0), pause(1)]).timer;
    expect(isPauseExpired(paused, at(1 + cfg.pauseTimeoutMin), cfg)).toBe(false);
    expect(isPauseExpired(paused, at(2 + cfg.pauseTimeoutMin), cfg)).toBe(true);
    expect(isPauseExpired(run(cfg, [start(0)]).timer, at(60), cfg)).toBe(false);
  });

  it('detener o descansar con la pausa vencida interrumpe el bloque', () => {
    const late = 1 + cfg.pauseTimeoutMin + 1;
    expect(run(cfg, [start(0), pause(1), stop(late)]).lastBlock?.outcome).toBe('interrupted');
    expect(run(cfg, [start(0), pause(1), takeBreak(late)]).lastBlock?.outcome).toBe('interrupted');
  });
});

describe('temporizador · fin de bloque por modo (§3, R8, R13)', () => {
  it('R13: estructurado espera la tarjeta en curso hasta la gracia', () => {
    const cfg = cfgWith({ mode: 'structured' });
    const grace = cfg.endOfBlockGraceSec / 60;
    const working = [start(0), ...ticksTo(0, 25, true)];
    expect(run(cfg, working).timer.state).toBe('focus');
    expect(run(cfg, [...working, cardDone(25.5)]).timer.state).toBe('break_short');
    expect(run(cfg, [...working, tick(25 + grace, true)]).timer.state).toBe('break_short');
    const done = run(cfg, [start(0), ...ticksTo(0, 25)]);
    expect(done.timer.state).toBe('break_short');
    expect(done.lastBlock).toMatchObject({ outcome: 'completed', activeMs: 25 * MIN });
  });

  it('AG4: la gracia de R13 sale de la config', () => {
    const events = [start(0), ...ticksTo(0, 25, true), tick(25.5, true)];
    expect(run(cfgWith({ mode: 'structured', endOfBlockGraceSec: 60 }), events).timer.state).toBe('focus');
    expect(run(cfgWith({ mode: 'structured', endOfBlockGraceSec: 20 }), events).timer.state).toBe(
      'break_short',
    );
  });

  it('estructurado: cardDone antes de 0 no corta el bloque', () => {
    expect(run(cfgWith({ mode: 'structured' }), [start(0), cardDone(10)]).timer.state).toBe('focus');
  });

  it('flexible: al llegar a 0 no corta; "+5 min" una sola vez por bloque', () => {
    const cfg = cfgWith({ mode: 'flexible' });
    const over = run(cfg, [start(0), ...ticksTo(0, 30), cardDone(31)]);
    expect(over.timer.state).toBe('focus');
    expect(remainingMs(over.timer, at(31))).toBe(0);
    const extended = run(cfg, [start(0), ...ticksTo(0, 25), extend(25)]);
    expect(extended.timer.plannedMs).toBe((cfg.focusMin + cfg.flexExtendMin) * MIN);
    const again = transition(extended.timer, extend(26), cfg);
    expect(again.error?.code).toBe('extend_unavailable');
    // El bloque siguiente vuelve a permitirlo.
    const next = run(cfg, [start(0), extend(1), takeBreak(31), skipBreak(36), extend(37)]);
    expect(next.timer.extendedThisBlock).toBe(true);
  });

  it('AG4: la extensión flexible sale de la config', () => {
    const s = run(cfgWith({ mode: 'flexible', flexExtendMin: 10 }), [start(0), extend(1)]);
    expect(s.timer.plannedMs).toBe((base.focusMin + 10) * MIN);
  });

  it('libre: solo registra; el bloque que ella cierra cuenta como completo', () => {
    const cfg = cfgWith({ mode: 'free' });
    expect(transition(run(cfg, [start(0)]).timer, extend(1), cfg).error?.code).toBe('extend_unavailable');
    expect(run(cfg, [start(0), ...ticksTo(0, 90)]).timer.state).toBe('focus');
    expect(run(cfg, [start(0), takeBreak(12)]).lastBlock?.outcome).toBe('completed');
  });

  it('descanso pedido antes de tiempo en estructurado no completa ciclo', () => {
    const s = run(cfgWith({ mode: 'structured' }), [start(0), takeBreak(10)]);
    expect(s.lastBlock?.outcome).toBe('interrupted');
    expect(s.timer).toMatchObject({ state: 'break_short', completedBlocks: 0, blockIndex: 1 });
  });

  it.each([2, 4])('R7: descanso largo tras %s bloques completados (cyclesBeforeLong)', (cycles) => {
    const cfg = cfgWith({ mode: 'structured', cyclesBeforeLong: cycles });
    const events: TimerEvent[] = [start(0)];
    let minute = 0;
    for (let i = 1; i <= cycles; i += 1) {
      events.push(...ticksTo(minute, minute + cfg.focusMin));
      minute += cfg.focusMin;
      if (i < cycles) {
        minute += cfg.shortBreakMin;
        events.push(skipBreak(minute));
      }
    }
    const s = run(cfg, events);
    expect(s.timer.state).toBe('break_long');
    expect(s.timer.plannedMs).toBe(cfg.longBreakMin * MIN);
    expect(s.blocks.filter((b) => b.kind === 'break_short')).toHaveLength(cycles - 1);
  });

  it('descanso: tiempo restante, omitido si termina antes y completo si no', () => {
    const cfg = cfgWith({ mode: 'structured' });
    const focus = [start(0), ...ticksTo(0, 25)];
    const onBreak = run(cfg, focus).timer;
    expect(remainingMs(onBreak, at(27))).toBe((cfg.shortBreakMin - 2) * MIN);
    expect(breakElapsedMs(onBreak, at(27))).toBe(2 * MIN);
    expect(run(cfg, [...focus, skipBreak(27)]).lastBlock).toMatchObject({
      kind: 'break_short',
      blockIndex: 0,
      outcome: 'interrupted',
    });
    expect(run(cfg, [...focus, skipBreak(40)]).lastBlock?.outcome).toBe('completed');
    expect(run(cfg, [...focus, stop(26)]).lastBlock?.kind).toBe('break_short');
  });
});

describe('temporizador · cierre a mitad, reloj y otros dispositivos', () => {
  const cfg = cfgWith({ mode: 'flexible' });

  it('§3: si la app vuelve antes del límite, el bloque sigue', () => {
    const s = run(cfg, [start(0), tick(1), tick(1 + cfg.pauseTimeoutMin)]);
    expect(s.timer.state).toBe('focus');
    expect(s.notice).toBeNull();
  });

  it('§3: si vuelve pasado el límite, el bloque se interrumpe hasta la última señal', () => {
    const s = run(cfg, [start(0), tick(3), tick(3 + cfg.pauseTimeoutMin + 1)]);
    expect(s.notice).toBe('interrupted_while_away');
    expect(s.timer).toMatchObject({ state: 'idle', blockIndex: 1, completedBlocks: 0 });
    expect(s.lastBlock).toMatchObject({ outcome: 'interrupted', activeMs: 3 * MIN, endedAt: at(3) });
    expect(run(cfg, [start(0), tick(3), tick(30), start(31)]).timer.blockIndex).toBe(1);
  });

  it('activeMs no decrece si el reloj del dispositivo retrocede', () => {
    const s = run(cfg, [start(0), ...ticksTo(0, 10), tick(4)]);
    expect(activeMs(s.timer, at(2))).toBe(10 * MIN);
    expect(remainingMs(s.timer, at(2))).toBe((cfg.focusMin - 10) * MIN);
  });

  it('un tick sin transición no pide sincronizar (SY7)', () => {
    const focus = run(cfg, [start(0)]).timer;
    const step = transition(focus, tick(1), cfg);
    expect(step.changed).toBe(false);
    expect(step.timer.lastSeenAt).toBe(at(1));
  });

  it('ADR-006: tomar el control cambia el dueño y aplica la ausencia del otro dispositivo', () => {
    expect(run(cfg, [start(0), takeover(2)]).timer).toMatchObject({
      state: 'focus',
      ownerDeviceId: OTHER_DEVICE,
    });
    const away = run(cfg, [start(0), tick(2), takeover(40)]);
    expect(away.notice).toBe('interrupted_while_away');
    expect(away.timer).toMatchObject({ state: 'idle', ownerDeviceId: OTHER_DEVICE });
  });

  it('SYNC §5: el servidor cierra una sesión duplicada como superseded', () => {
    const s = transition(run(cfg, [start(0)]).timer, { type: 'stop', now: at(5), reason: 'superseded' }, cfg);
    expect(s.timer).toMatchObject({ state: 'ended', endedReason: 'superseded' });
    expect(s.closed?.outcome).toBe('interrupted');
  });

  it('§3: el tiempo declarado fuera de la app se guarda como manual', () => {
    const interrupted = run(cfg, [start(0), tick(3), tick(40)]).lastBlock!;
    expect(manualBlock(interrupted, 20, at(40))).toMatchObject({
      outcome: 'manual',
      activeMs: 20 * MIN,
      startedAt: at(3),
      endedAt: at(23),
    });
    expect(() => manualBlock(interrupted, 0, at(40))).toThrow('manual_minutes_out_of_range');
    expect(() => manualBlock(interrupted, 1.5, at(40))).toThrow('manual_minutes_out_of_range');
    expect(() => manualBlock(interrupted, 38, at(40))).toThrow('manual_minutes_out_of_range');
  });
});

describe('temporizador · propiedades (QA2)', () => {
  const eventArb = fc.record({
    type: fc.constantFrom<TimerEventType>(
      'start',
      'pause',
      'resume',
      'tick',
      'cardDone',
      'extend',
      'takeBreak',
      'skipBreak',
      'stop',
      'takeover',
    ),
    // Saltos de reloj de −10 a +40 min: incluye relojes que retroceden.
    deltaMs: fc.integer({ min: -10 * MIN, max: 40 * MIN }),
    cardInProgress: fc.boolean(),
  });
  const cfgArb = fc.record({
    mode: fc.constantFrom<TimerMode>('structured', 'flexible', 'free'),
    focusMin: fc.integer({ min: 5, max: 120 }),
    shortBreakMin: fc.integer({ min: 1, max: 30 }),
    longBreakMin: fc.integer({ min: 5, max: 60 }),
    cyclesBeforeLong: fc.integer({ min: 2, max: 6 }),
    pauseTimeoutMin: fc.integer({ min: 1, max: 120 }),
    endOfBlockGraceSec: fc.integer({ min: 0, max: 300 }),
    flexExtendMin: fc.integer({ min: 1, max: 30 }),
  });

  it('remainingMs ≥ 0, activeMs no decrece y los errores no cambian el estado', () => {
    fc.assert(
      fc.property(cfgArb, fc.array(eventArb, { maxLength: 60 }), (cfg, raw) => {
        let timer = createTimer(cfg.mode, DEVICE);
        let now = T0;
        const problems: string[] = [];
        const check = (ok: boolean, what: string) => {
          if (!ok) problems.push(`${what} tras ${JSON.stringify(timer)}`);
        };
        for (const { type, deltaMs, cardInProgress } of raw) {
          now = Math.max(0, now + deltaMs);
          const event: TimerEvent =
            type === 'takeover'
              ? { type, now, deviceId: OTHER_DEVICE }
              : type === 'tick'
                ? { type, now, cardInProgress }
                : { type, now };
          const before = activeMs(timer, now);
          const step = transition(timer, event, cfg);
          const sameBlock =
            step.timer.blockIndex === timer.blockIndex &&
            (step.timer.state === 'focus' || step.timer.state === 'paused');
          check(!step.error || step.timer === timer, `${type} inválido cambió el estado`);
          check(!sameBlock || activeMs(step.timer, now) >= before, `${type} hizo decrecer activeMs`);
          const closed = step.closed;
          check(!closed || closed.endedAt >= closed.startedAt, `${type} cerró antes de empezar`);
          check(
            closed?.kind !== 'focus' || closed.activeMs <= closed.endedAt - closed.startedAt,
            `${type} dio más activo que transcurrido`,
          );
          timer = step.timer;
          check(remainingMs(timer, now) >= 0, 'remainingMs negativo');
          check(remainingMs(timer, now - 15 * MIN) >= 0, 'remainingMs negativo con reloj atrasado');
        }
        expect(problems).toEqual([]);
      }),
    );
  });
});
