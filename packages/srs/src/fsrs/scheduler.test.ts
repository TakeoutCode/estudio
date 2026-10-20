import { defaultStudyConfig, type Rating, type ReviewLog } from '@estudio/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byReviewOrder, createScheduler, newCardState, replay } from './scheduler.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 12);
const CARD = '0192f1a0-0000-7000-8000-0000000000c1';
const SESSION = '0192f1a0-0000-7000-8000-0000000000a1';
const DEVICE = '0192f1a0-0000-7000-8000-0000000000d1';

let seq = 0;
const log = (reviewedAt: number, rating: Rating, type: ReviewLog['type'] = 'review'): ReviewLog => {
  seq += 1;
  return {
    id: `0192f1a0-0000-7000-8000-${seq.toString().padStart(12, '0')}`,
    cardId: CARD,
    cardKind: 'basic',
    reviewedAt,
    rating,
    durationMs: 3_000,
    type,
    confidence: null,
    sessionId: SESSION,
    deviceId: DEVICE,
  };
};

const cfg = defaultStudyConfig();
const history = [
  log(T0, 3),
  log(T0 + 10 * 60_000, 3),
  log(T0 + DAY, 3),
  log(T0 + 4 * DAY, 2),
  log(T0 + 9 * DAY, 3),
];

describe('scheduler FSRS (ARC5)', () => {
  it('una tarjeta nueva vence al crearse', () => {
    const s = newCardState(CARD, T0);
    expect(s).toMatchObject({ cardId: CARD, due: T0, phase: 'new', reps: 0, lastReview: null });
  });

  it('R2: más retención objetivo da intervalos más cortos', () => {
    const at = (requestRetention: number) =>
      replay(
        createScheduler({ ...cfg.fsrs, requestRetention, enableFuzz: false }),
        newCardState(CARD, T0),
        history,
        cfg.exam,
      );
    const high = at(0.95);
    const low = at(0.8);
    expect(high.phase).toBe('review');
    expect(high.due - (high.lastReview ?? 0)).toBeLessThan(low.due - (low.lastReview ?? 0));
  });

  it('es determinista con fuzz: dos programadores iguales dan el mismo estado', () => {
    const run = () => replay(createScheduler(cfg.fsrs), newCardState(CARD, T0), history, cfg.exam);
    expect(run()).toEqual(run());
  });

  it('SY-T8: el orden de llegada de los logs no cambia el resultado', () => {
    const scheduler = createScheduler(cfg.fsrs);
    const expected = replay(scheduler, newCardState(CARD, T0), history, cfg.exam);
    fc.assert(
      fc.property(fc.shuffledSubarray(history, { minLength: history.length }), (arrival) => {
        expect(replay(scheduler, newCardState(CARD, T0), arrival, cfg.exam)).toEqual(expected);
      }),
    );
  });

  it('P7: un simulacro solo cuenta si exam.affectsScheduling', () => {
    const scheduler = createScheduler(cfg.fsrs);
    const withExam = [...history, log(T0 + 10 * DAY, 1, 'exam')];
    const base = replay(scheduler, newCardState(CARD, T0), history, cfg.exam);
    const counted = replay(scheduler, newCardState(CARD, T0), withExam, { affectsScheduling: true });
    const ignored = replay(scheduler, newCardState(CARD, T0), withExam, { affectsScheduling: false });
    expect(ignored).toEqual(base);
    expect(counted.lapses).toBe(base.lapses + 1);
  });

  it('ignora logs de otras tarjetas', () => {
    const scheduler = createScheduler(cfg.fsrs);
    const other = { ...log(T0 + DAY, 1), cardId: '0192f1a0-0000-7000-8000-0000000000c2' };
    expect(replay(scheduler, newCardState(CARD, T0), [...history, other], cfg.exam)).toEqual(
      replay(scheduler, newCardState(CARD, T0), history, cfg.exam),
    );
  });

  it('desempata por id cuando dos repasos tienen la misma hora', () => {
    const a = { reviewedAt: T0, id: 'a' };
    const b = { reviewedAt: T0, id: 'b' };
    expect(byReviewOrder(a, b)).toBeLessThan(0);
    expect(byReviewOrder(b, a)).toBeGreaterThan(0);
    expect(byReviewOrder(a, a)).toBe(0);
  });
});
