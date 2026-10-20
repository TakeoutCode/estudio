import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CardClock,
  cardElapsedMs,
  type CardPause,
  pauseCardClock,
  resumeCardClock,
  startCardClock,
} from './card-clock.js';

const SEC = 1_000;
const T0 = Date.UTC(2026, 9, 20, 15);
const at = (seconds: number) => T0 + seconds * SEC;

describe('reloj de la tarjeta (R3)', () => {
  it('sin pausas cuenta de mostrarla a responderla', () => {
    expect(cardElapsedMs(startCardClock(at(0)), at(6.5))).toBe(6_500);
  });

  it('§3: el descanso no cuenta y el reloj sigue desde donde quedó', () => {
    let clock = startCardClock(at(0));
    clock = pauseCardClock(clock, 'break', at(10));
    expect(cardElapsedMs(clock, at(100))).toBe(10_000); // detenido
    clock = resumeCardClock(clock, 'break', at(190));
    expect(cardElapsedMs(clock, at(195))).toBe(15_000);
  });

  it('con la app oculta o fuera de la pantalla de estudio tampoco cuenta', () => {
    let clock = startCardClock(at(0));
    clock = pauseCardClock(clock, 'hidden', at(4));
    clock = resumeCardClock(clock, 'hidden', at(3_600)); // una hora con el teléfono bloqueado
    clock = pauseCardClock(clock, 'away', at(3_602));
    clock = resumeCardClock(clock, 'away', at(7_200));
    expect(cardElapsedMs(clock, at(7_203))).toBe(9_000);
  });

  it('pausas solapadas descuentan su unión, sin contar dos veces el tramo común', () => {
    // Descanso [10, 100] y app oculta [50, 150]: se descuenta [10, 150].
    const opened = pauseCardClock(pauseCardClock(startCardClock(at(0)), 'break', at(10)), 'hidden', at(50));
    const hiddenFirst = resumeCardClock(resumeCardClock(opened, 'hidden', at(150)), 'break', at(100));
    const breakFirst = resumeCardClock(resumeCardClock(opened, 'break', at(100)), 'hidden', at(150));
    for (const clock of [hiddenFirst, breakFirst]) {
      expect(clock.runningSince).toBe(at(150));
      expect(cardElapsedMs(clock, at(160))).toBe(20_000);
    }
  });

  it('abrir una pausa ya abierta o cerrar una que no está no cambia nada', () => {
    const paused = pauseCardClock(startCardClock(at(0)), 'hidden', at(5));
    expect(pauseCardClock(paused, 'hidden', at(8))).toBe(paused);
    expect(resumeCardClock(paused, 'break', at(8))).toBe(paused);
    const running = startCardClock(at(0));
    expect(resumeCardClock(running, 'away', at(3))).toBe(running);
  });

  it('la tarjeta siguiente hereda las pausas abiertas: presentada con la app oculta, no corre', () => {
    const previous = pauseCardClock(startCardClock(at(0)), 'hidden', at(20));
    let clock = startCardClock(at(30), previous);
    expect(cardElapsedMs(clock, at(90))).toBe(0);
    clock = resumeCardClock(clock, 'hidden', at(100));
    expect(cardElapsedMs(clock, at(104))).toBe(4_000);
  });

  it('una marca de pausa anterior al tramo en curso no quita tiempo ya contado', () => {
    // El descanso empezó (según el servidor) antes de presentar la tarjeta.
    let clock = pauseCardClock(startCardClock(at(100)), 'break', at(50));
    expect(clock.accumulatedMs).toBe(0);
    clock = resumeCardClock(clock, 'break', at(40)); // fin anterior a su inicio: pausa de largo 0
    expect(clock.runningSince).toBe(at(100));
    expect(cardElapsedMs(clock, at(103))).toBe(3_000);
  });

  it('un reloj que retrocede no da duraciones negativas', () => {
    expect(cardElapsedMs(startCardClock(at(10)), at(5))).toBe(0);
    const clock = resumeCardClock(pauseCardClock(startCardClock(at(0)), 'hidden', at(8)), 'hidden', at(20));
    expect(cardElapsedMs(clock, at(15))).toBe(8_000);
  });
});

describe('reloj de la tarjeta · propiedades', () => {
  const reasons: readonly CardPause[] = ['break', 'hidden', 'away'];
  const event = fc.record({
    op: fc.constantFrom('pause', 'resume'),
    reason: fc.constantFrom(...reasons),
    delayMs: fc.integer({ min: 0, max: 600_000 }),
  });
  const apply = (clock: CardClock, op: string, reason: CardPause, time: number) =>
    op === 'pause' ? pauseCardClock(clock, reason, time) : resumeCardClock(clock, reason, time);

  it('con marcas en orden, la duración es el tiempo sin ninguna pausa abierta', () => {
    fc.assert(
      fc.property(
        fc.array(event, { maxLength: 30 }),
        fc.integer({ min: 0, max: 600_000 }),
        (events, tail) => {
          let clock = startCardClock(T0);
          let time = T0;
          const open = new Set<CardPause>();
          let expected = 0;
          for (const { op, reason, delayMs } of events) {
            if (open.size === 0) expected += delayMs;
            time += delayMs;
            clock = apply(clock, op, reason, time);
            if (op === 'pause') open.add(reason);
            else open.delete(reason);
          }
          if (open.size === 0) expected += tail;
          expect(cardElapsedMs(clock, time + tail)).toBe(expected);
        },
      ),
    );
  });

  it('con marcas en cualquier orden, nunca es negativa ni pasa del tiempo transcurrido', () => {
    const start = T0 + 3_600_000;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            op: fc.constantFrom('pause', 'resume'),
            reason: fc.constantFrom(...reasons),
            time: fc.integer({ min: T0, max: start + 3_600_000 }),
          }),
          { maxLength: 30 },
        ),
        (events) => {
          const end = start + 3_600_000;
          const clock = events.reduce((c, e) => apply(c, e.op, e.reason, e.time), startCardClock(start));
          const elapsed = cardElapsedMs(clock, end);
          expect(elapsed).toBeGreaterThanOrEqual(0);
          expect(elapsed).toBeLessThanOrEqual(end - start);
        },
      ),
    );
  });
});
