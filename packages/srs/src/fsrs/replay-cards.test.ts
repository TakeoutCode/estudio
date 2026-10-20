import { defaultStudyConfig, Rating, type ReviewLog } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { DAY, id, log, NOW } from '../test/planner-fixtures.js';
import { logsByCard, replayCards, replaySettingsKey } from './replay-cards.js';
import { createScheduler, newCardState, replay } from './scheduler.js';

const cfg = defaultStudyConfig();
const cards = [1, 2, 3].map((n) => ({ cardId: id(n), createdAt: NOW - 40 * DAY + n }));
const history = (cardId: string, start: number): ReviewLog[] => [
  log(start, Rating.Good, { type: 'learn', cardId }),
  log(start + 600_000, Rating.Good, { type: 'learn', cardId }),
  log(start + 3 * DAY, Rating.Good, { cardId }),
  log(start + 10 * DAY, Rating.Hard, { cardId }),
];
const logs = [...history(id(1), NOW - 30 * DAY), ...history(id(2), NOW - 20 * DAY)];

describe('replayCards (ARC5, FE4)', () => {
  it('da el mismo estado que reproducir cada tarjeta por separado', () => {
    const scheduler = createScheduler(cfg.fsrs);
    const expected = cards.map((c) => replay(scheduler, newCardState(c.cardId, c.createdAt), logs, cfg.exam));
    expect(replayCards(cards, logs, cfg)).toEqual(expected);
  });

  it('una tarjeta sin repasos queda nueva y el orden de llegada del log no importa', () => {
    const states = replayCards(cards, [...logs].reverse(), cfg);
    expect(states.map((s) => s.phase)).toEqual(['review', 'review', 'new']);
    expect(states).toEqual(replayCards(cards, logs, cfg));
  });

  it('R2: con otra retención cambian las fechas, no los repasos', () => {
    const at90 = replayCards(cards, logs, cfg);
    const at95 = replayCards(cards, logs, { ...cfg, fsrs: { ...cfg.fsrs, requestRetention: 0.95 } });
    expect(at95.map((s) => s.reps)).toEqual(at90.map((s) => s.reps));
    expect(at95[0]?.due).toBeLessThan(at90[0]?.due ?? 0);
  });

  it('logsByCard agrupa en una pasada', () => {
    const grouped = logsByCard(logs);
    expect(grouped.get(id(1))).toHaveLength(4);
    expect(grouped.get(id(3))).toBeUndefined();
  });
});

describe('replaySettingsKey', () => {
  const key = replaySettingsKey(cfg);

  it.each([
    ['requestRetention', { fsrs: { ...cfg.fsrs, requestRetention: 0.85 } }],
    ['maximumIntervalDays', { fsrs: { ...cfg.fsrs, maximumIntervalDays: 365 } }],
    ['enableFuzz', { fsrs: { ...cfg.fsrs, enableFuzz: false } }],
    ['exam.affectsScheduling', { exam: { ...cfg.exam, affectsScheduling: false } }],
  ])('cambia con %s', (_name, patch) => {
    expect(replaySettingsKey({ ...cfg, ...patch })).not.toBe(key);
  });

  it('no cambia con lo que no afecta a replay()', () => {
    expect(replaySettingsKey({ ...cfg, fsrs: { ...cfg.fsrs, projectionDays: 90 } })).toBe(key);
    expect(replaySettingsKey({ ...cfg, exam: { ...cfg.exam, mockSize: 50 } })).toBe(key);
  });
});
