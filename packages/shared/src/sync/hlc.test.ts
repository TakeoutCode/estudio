import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareHlc,
  decodeHlc,
  encodeHlc,
  type Hlc,
  initialHlc,
  isHlcTooFarAhead,
  MAX_HLC_DRIFT_MS,
  receiveHlc,
  tickHlc,
} from './hlc.js';

const NODE_A = '0192f1a0-0000-7000-8000-00000000000a';
const NODE_B = '0192f1a0-0000-7000-8000-00000000000b';

const hlcArb = fc.record({
  wall: fc.integer({ min: 0, max: 9_999_999_999_999 }),
  counter: fc.integer({ min: 0, max: 36 ** 4 - 1 }),
  node: fc.constantFrom(NODE_A, NODE_B),
});

const tupleCompare = (a: Hlc, b: Hlc): number =>
  a.wall - b.wall || a.counter - b.counter || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0);

describe('HLC (SYNC §2)', () => {
  it('codifica y decodifica sin pérdida', () => {
    fc.assert(
      fc.property(hlcArb, (h) => {
        expect(decodeHlc(encodeHlc(h))).toEqual(h);
      }),
    );
  });

  it('el orden del texto es el mismo que el de (wall, counter, node), como COLLATE "C"', () => {
    fc.assert(
      fc.property(hlcArb, hlcArb, (a, b) => {
        expect(Math.sign(compareHlc(encodeHlc(a), encodeHlc(b)))).toBe(Math.sign(tupleCompare(a, b)));
      }),
    );
  });

  it('tickHlc es monótono aunque el reloj del dispositivo retroceda', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2_000_000_000_000 }), { minLength: 1, maxLength: 50 }),
        (clock) => {
          let last = initialHlc(NODE_A);
          for (const now of clock) {
            const next = tickHlc(last, now);
            expect(compareHlc(encodeHlc(next), encodeHlc(last))).toBeGreaterThan(0);
            last = next;
          }
        },
      ),
    );
  });

  it('receiveHlc queda por delante del local y del remoto, con el nodo local', () => {
    fc.assert(
      fc.property(hlcArb, hlcArb, fc.integer({ min: 0, max: 9_999_999_999_999 }), (local, remote, now) => {
        const l = { ...local, node: NODE_A };
        const merged = receiveHlc(l, { ...remote, node: NODE_B }, now);
        expect(tupleCompare(merged, l)).toBeGreaterThan(0);
        const aheadOfRemote =
          merged.wall > remote.wall || (merged.wall === remote.wall && merged.counter > remote.counter);
        expect(aheadOfRemote).toBe(true);
        expect(merged.node).toBe(NODE_A);
      }),
    );
  });

  it('receiveHlc usa el reloj actual y reinicia el contador si va por delante de ambos', () => {
    const merged = receiveHlc(
      { wall: 10, counter: 5, node: NODE_A },
      { wall: 20, counter: 7, node: NODE_B },
      30,
    );
    expect(merged).toEqual({ wall: 30, counter: 0, node: NODE_A });
  });

  it('agotar el contador en el mismo milisegundo avanza el reloj lógico', () => {
    const next = tickHlc({ wall: 100, counter: 36 ** 4 - 1, node: NODE_A }, 50);
    expect(next).toEqual({ wall: 101, counter: 0, node: NODE_A });
  });

  it('rechaza textos que no son HLC', () => {
    expect(() => decodeHlc('no-es-un-hlc')).toThrow('invalid_hlc');
  });

  it('detecta un HLC demasiado en el futuro', () => {
    const now = 1_000_000;
    expect(isHlcTooFarAhead({ wall: now + MAX_HLC_DRIFT_MS + 1, counter: 0, node: NODE_A }, now)).toBe(true);
    expect(isHlcTooFarAhead({ wall: now + MAX_HLC_DRIFT_MS, counter: 0, node: NODE_A }, now)).toBe(false);
  });
});
