import {
  type CardKind,
  type GamificationConfig,
  GamificationConfigSchema,
  newId,
  type ReviewLog,
  type ReviewType,
  type TimerBlockLog,
} from '@estudio/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, NOW, TODAY_START, TZ } from '../test/planner-fixtures.js';
import {
  BADGES,
  coinBalance,
  coinsForXp,
  type GamificationInput,
  gamificationSummary,
  levelProgress,
  newMilestones,
  progressAfter,
  xpForLevel,
} from './summary.js';

const cfg = (overrides: Record<string, unknown> = {}): GamificationConfig =>
  GamificationConfigSchema.parse({ enabled: true, ...overrides });

const log = (
  at: number,
  {
    type = 'review',
    cardKind = 'basic',
    rating = 3,
  }: { type?: ReviewType; cardKind?: CardKind; rating?: 1 | 2 | 3 | 4 } = {},
): ReviewLog => ({
  id: newId(),
  cardId: newId(),
  cardKind,
  reviewedAt: at,
  rating,
  durationMs: 4000,
  type,
  confidence: null,
  sessionId: newId(),
  deviceId: newId(),
});

const block = (endedAt: number, overrides: Partial<TimerBlockLog> = {}): TimerBlockLog => ({
  id: newId(),
  timerSessionId: newId(),
  deviceId: newId(),
  kind: 'focus',
  blockIndex: 0,
  mode: 'flexible',
  startedAt: endedAt - 25 * 60_000,
  endedAt,
  plannedMs: 25 * 60_000,
  activeMs: 25 * 60_000,
  outcome: 'completed',
  extended: false,
  ...overrides,
});

const input = (overrides: Partial<GamificationInput> = {}): GamificationInput => ({
  logs: [],
  blocks: [],
  redemptions: [],
  config: cfg(),
  now: NOW,
  timeZone: TZ,
  ...overrides,
});

const times = (count: number) => Array.from({ length: count }, (_, i) => log(TODAY_START + i * 60_000));

describe('UX10: XP, niveles y monedas (diseño · sin evidencia)', () => {
  it('R19: la misma XP por cada repaso respondido, sin importar la calificación ni el tipo', () => {
    const again = [log(NOW, { rating: 1 }), log(NOW, { rating: 1, type: 'learn' })];
    const easy = [log(NOW, { rating: 4 }), log(NOW, { rating: 4, type: 'exam' })];
    expect(gamificationSummary(input({ logs: again })).xp).toBe(20);
    expect(gamificationSummary(input({ logs: easy })).xp).toBe(20);
  });

  it('AG4: `xpPerReview` viene de la configuración, en su mínimo y su máximo', () => {
    expect(gamificationSummary(input({ logs: times(3), config: cfg({ xpPerReview: 1 }) })).xp).toBe(3);
    expect(gamificationSummary(input({ logs: times(3), config: cfg({ xpPerReview: 100 }) })).xp).toBe(300);
  });

  it('nivel n pide baseXp × n^exponent: 100, 283 y 520 con los valores iniciales', () => {
    const c = cfg();
    expect([1, 2, 3].map((n) => xpForLevel(n, c))).toEqual([100, 283, 520]);
    expect(levelProgress(0, c)).toEqual({ level: 1, xpInLevel: 0, xpForLevel: 100 });
    expect(levelProgress(99, c)).toEqual({ level: 1, xpInLevel: 99, xpForLevel: 100 });
    expect(levelProgress(100, c)).toEqual({ level: 2, xpInLevel: 0, xpForLevel: 283 });
    expect(levelProgress(383, c)).toEqual({ level: 3, xpInLevel: 0, xpForLevel: 520 });
  });

  it('AG4: la curva cambia con `baseXp` y `exponent` (mínimos y máximos)', () => {
    const flat = cfg({ levelCurve: { baseXp: 10, exponent: 1 } });
    expect([1, 2, 3].map((n) => xpForLevel(n, flat))).toEqual([10, 20, 30]);
    expect(levelProgress(60, flat)).toEqual({ level: 4, xpInLevel: 0, xpForLevel: 40 });
    const steep = cfg({ levelCurve: { baseXp: 10_000, exponent: 3 } });
    expect(xpForLevel(2, steep)).toBe(80_000);
    expect(levelProgress(89_999, steep)).toEqual({ level: 2, xpInLevel: 79_999, xpForLevel: 80_000 });
  });

  it('monedas = XP × `coinsPerXp`, truncadas y sin perder una por la coma flotante', () => {
    expect(coinsForXp(100, cfg())).toBe(10);
    expect(coinsForXp(9, cfg())).toBe(0);
    expect(coinsForXp(100, cfg({ coinsPerXp: 0.29 }))).toBe(29); // 0.29 × 100 = 28.999… en binario
    expect(coinsForXp(100, cfg({ coinsPerXp: 0 }))).toBe(0);
    expect(coinsForXp(100, cfg({ coinsPerXp: 1 }))).toBe(100);
  });

  it('el saldo se calcula: ganadas menos lo canjeado (SYNC §1, no se guarda)', () => {
    expect(coinBalance(30, [{ cost: 12 }, { cost: 5 }], cfg())).toEqual({
      earned: 30,
      spent: 17,
      balance: 13,
    });
    // Dos canjes sin red en dos dispositivos pueden dejarlo negativo; se informa tal cual.
    expect(coinBalance(3, [{ cost: 2 }, { cost: 2 }], cfg()).balance).toBe(-1);
    expect(gamificationSummary(input({ logs: times(30), redemptions: [{ cost: 12 }] })).coins).toEqual({
      earned: 30,
      spent: 12,
      balance: 18,
    });
  });

  it('propiedad: la XP en el nivel siempre cabe en él y la XP total se conserva', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 10, max: 10_000 }),
        fc.double({ min: 1, max: 3, noNaN: true }),
        (xp, baseXp, exponent) => {
          const c = cfg({ levelCurve: { baseXp, exponent } });
          const p = levelProgress(xp, c);
          let below = 0;
          for (let n = 1; n < p.level; n += 1) below += xpForLevel(n, c);
          expect(p.xpInLevel).toBeGreaterThanOrEqual(0);
          expect(p.xpInLevel).toBeLessThan(p.xpForLevel);
          expect(below + p.xpInLevel).toBe(xp);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('UX10: logros por conductas propias', () => {
  it('sin nada hecho no hay logros', () => {
    expect(gamificationSummary(input()).badges).toEqual([]);
  });

  it('cada logro guarda la primera vez, aunque los logs lleguen desordenados', () => {
    const logs = [
      log(NOW, { type: 'contrast' }),
      log(NOW - 2 * DAY, { cardKind: 'sequence' }),
      log(NOW - 3 * DAY),
      log(NOW - DAY, { type: 'exam' }),
      log(NOW - 4 * DAY, { type: 'learn', cardKind: 'clinical_case' }),
    ];
    const blocks = [
      block(NOW - 5 * DAY, { outcome: 'interrupted' }),
      block(NOW - 4 * DAY, { kind: 'break_short' }),
      block(NOW - HOUR),
    ];
    expect(gamificationSummary(input({ logs, blocks })).badges).toEqual([
      { id: 'first_review', earnedAt: NOW - 4 * DAY },
      { id: 'first_exercise', earnedAt: NOW - 4 * DAY },
      { id: 'first_contrast_set', earnedAt: NOW },
      { id: 'first_mock', earnedAt: NOW - DAY },
      { id: 'first_focus_block', earnedAt: NOW - HOUR },
    ]);
    expect(BADGES).toHaveLength(5);
  });

  it('un bloque interrumpido o un descanso no dan el logro del primer bloque', () => {
    const blocks = [block(NOW, { outcome: 'interrupted' }), block(NOW, { kind: 'break_long' })];
    expect(gamificationSummary(input({ blocks })).badges).toEqual([]);
  });
});

describe('UX10: racha opcional que se pausa y nunca se rompe', () => {
  const at = (daysAgo: number, hour = 9) => log(TODAY_START - daysAgo * DAY + hour * HOUR);

  it('apagada por defecto: no se calcula', () => {
    expect(gamificationSummary(input({ logs: [at(0)] })).streak).toBeNull();
  });

  it('cuenta días locales con repasos: dos en el mismo día de ella son uno (AG6)', () => {
    const config = cfg({ streakEnabled: true });
    // 23:30 de anteayer en CDMX ya es ayer en UTC; sigue siendo anteayer para ella.
    const logs = [at(2, 8), at(2, 23.5), at(0)];
    expect(gamificationSummary(input({ logs, config })).streak).toEqual({ days: 2, state: 'active' });
    expect(gamificationSummary(input({ logs: [], config })).streak).toEqual({ days: 0, state: 'active' });
  });

  it('un día sin estudiar la pone en pausa sin bajar los días; al volver sigue contando', () => {
    const config = cfg({ streakEnabled: true });
    expect(gamificationSummary(input({ logs: [at(1)], config })).streak).toEqual({
      days: 1,
      state: 'active',
    });
    const before = [at(5), at(4), at(2)];
    expect(gamificationSummary(input({ logs: before, config })).streak).toEqual({ days: 3, state: 'paused' });
    expect(gamificationSummary(input({ logs: [...before, at(0)], config })).streak).toEqual({
      days: 4,
      state: 'active',
    });
  });
});

describe('UX6: celebraciones solo en hitos', () => {
  it('avisa al subir de nivel o al ganar un logro nuevo, no en cada repaso', () => {
    const before = gamificationSummary(input({ logs: times(5) }));
    const sameLevel = gamificationSummary(input({ logs: times(6) }));
    expect(newMilestones(before, sameLevel)).toEqual([]);

    const levelUp = gamificationSummary(input({ logs: [...times(9), log(NOW, { type: 'contrast' })] }));
    expect(newMilestones(before, levelUp)).toEqual([
      { kind: 'level', level: 2 },
      { kind: 'badge', id: 'first_contrast_set' },
    ]);
    expect(newMilestones(gamificationSummary(input()), before)).toEqual([
      { kind: 'badge', id: 'first_review' },
    ]);
  });

  it('progressAfter: con solo lo nuevo da el mismo nivel y logros que recalcular todo', () => {
    const old = [...times(7), log(NOW - 3 * DAY, { type: 'exam' })];
    const blocks = [block(NOW - DAY)];
    const added = {
      logs: [log(NOW, { type: 'contrast' }), log(NOW - 5 * DAY, { type: 'exam' })],
      blocks: [],
    };
    const before = gamificationSummary(input({ logs: old, blocks }));
    const full = gamificationSummary(input({ logs: [...old, ...added.logs], blocks }));
    const after = progressAfter(before, added, cfg());
    expect(after.reviews).toBe(full.reviews);
    expect(after.level).toEqual(full.level);
    // El logro que ya tenía conserva su primera vez: el resumen previo manda sobre lo nuevo.
    expect(after.badges).toEqual(
      before.badges
        .concat([{ id: 'first_contrast_set', earnedAt: NOW }])
        .sort((a, b) => BADGES.indexOf(a.id) - BADGES.indexOf(b.id)),
    );
    expect(newMilestones(before, after)).toEqual([
      { kind: 'level', level: 2 },
      { kind: 'badge', id: 'first_contrast_set' },
    ]);
    expect(progressAfter(before, { logs: [], blocks: [] }, cfg())).toEqual({
      reviews: before.reviews,
      level: before.level,
      badges: before.badges,
    });
  });
});
