import { defaultStudyConfig, type TimerBlockLog } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, NOW, TODAY_START, TZ } from '../test/planner-fixtures.js';
import { breakUsage } from './breaks.js';

type Block = Pick<TimerBlockLog, 'kind' | 'outcome' | 'extended' | 'endedAt'>;
const block = (kind: Block['kind'], outcome: Block['outcome'], endedAt: number, extended = false): Block => ({
  kind,
  outcome,
  endedAt,
  extended,
});
const config = defaultStudyConfig();

describe('§5: uso de descansos', () => {
  it('§5: tomados, terminados antes y bloques extendidos en sus últimas semanas', () => {
    const blocks = [
      block('focus', 'completed', NOW - HOUR, true),
      block('break_short', 'completed', NOW - HOUR + 5 * 60_000),
      block('focus', 'completed', NOW - 2 * DAY),
      block('break_short', 'interrupted', NOW - 2 * DAY + 60_000),
      block('break_long', 'completed', NOW - 3 * DAY),
      block('focus', 'manual', NOW - 3 * DAY), // lo declarado a mano no es uso del temporizador
      block('focus', 'completed', TODAY_START - 30 * DAY, true), // fuera de las 4 semanas
    ];
    expect(breakUsage(blocks, config, NOW, TZ)).toEqual({
      since: TODAY_START - 27 * DAY,
      taken: 2,
      cutShort: 1,
      extended: 1,
      focusBlocks: 2,
    });
  });

  it('AG4: la ventana sale de `metrics.baselineWeeks`', () => {
    const old = [block('focus', 'completed', NOW - 10 * DAY, true)];
    expect(breakUsage(old, config, NOW, TZ).extended).toBe(1);
    const oneWeek = { metrics: { ...config.metrics, baselineWeeks: 1 } };
    expect(breakUsage(old, oneWeek, NOW, TZ)).toMatchObject({ extended: 0, since: TODAY_START - 6 * DAY });
  });
});
