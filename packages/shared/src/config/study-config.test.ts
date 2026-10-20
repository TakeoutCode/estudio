import { describe, expect, it } from 'vitest';
import {
  defaultStudyConfig,
  RETENTION_RANGE,
  StudyConfigSchema,
  TIMER_PRESETS,
  TIMER_RANGES,
} from './study-config.js';

describe('StudyConfig: valores iniciales = STUDY-METHODS', () => {
  const cfg = defaultStudyConfig();

  it('R2: retención objetivo 0.90; LD8: la carga se proyecta con 30 días simulados', () => {
    expect(cfg.fsrs.requestRetention).toBe(0.9);
    expect(cfg.fsrs.projectionDays).toBe(30);
  });

  it('P1-P8: umbrales del planificador', () => {
    expect(cfg.planner).toMatchObject({
      newPerSessionMax: 10,
      bootstrapReviewSec: 20,
      bootstrapNewSec: 60,
      timingMinSamples: 20,
      sessionBlocksDefault: 1,
      overdueFactorForZeroNew: 2,
      lowRetentionWindowDays: 3,
      lowRetentionDropPts: 10,
      lowRetentionMinReviews: 20,
      leechLapses: 6,
      lowRetentionPersistDays: 7,
      persistNewFactor: 0.5,
      reviewMaxSameTopicRun: 5,
      newMaxSameTopicRun: 10,
      fatigueWindowCards: 10,
      fatigueAccuracyDropPts: 20,
      fatigueLatencyFactor: 1.5,
      stopAfterNetBlocks: 4,
      fatigueWarningsToStop: 2,
      backlogSpreadMinDays: 3,
      backlogSpreadMaxDays: 7,
    });
  });

  it('R7, §3: temporizador 25/5, descanso largo 20, 4 ciclos, pausa 10 min, gracia 60 s', () => {
    expect(cfg.timer).toMatchObject({
      focusMin: 25,
      shortBreakMin: 5,
      longBreakMin: 20,
      cyclesBeforeLong: 4,
      pauseTimeoutMin: 10,
      endOfBlockGraceSec: 60,
      flexExtendMin: 5,
    });
  });

  it('§3: presets 25/5, 24/6, 12/3, 50/10 y 90/20', () => {
    expect(TIMER_PRESETS.map((p) => p.id)).toEqual(['25-5', '24-6', '12-3', '50-10', '90-20']);
  });

  it('R21, §5: corte de inactividad 90 s y métricas ocultas con menos de 100 repasos', () => {
    expect(cfg.metrics.inactivityCutoffSec).toBe(90);
    expect(cfg.metrics.minReviewsToShow).toBe(100);
    expect(cfg.metrics).toMatchObject({
      baselineWeeks: 4,
      calibrationMinSamples: 20,
      calibrationBiasMargin: 0.1,
      calibrationResolutionMin: 0.3,
    });
  });

  it('R6, P7: confianza opcional en repasos; simulacros afectan FSRS y solo 3 es confianza alta', () => {
    expect(cfg.review.askConfidence).toBe(false);
    expect(cfg.exam).toMatchObject({ affectsScheduling: true, highConfidenceMin: 3, feedbackTiming: 'end' });
  });
});

describe('StudyConfig: rangos', () => {
  it.each([
    [{ fsrs: { requestRetention: 0.79 } }],
    [{ fsrs: { requestRetention: 0.96 } }],
    [{ fsrs: { projectionDays: 6 } }],
    [{ fsrs: { projectionDays: 91 } }],
    [{ timer: { focusMin: 4 } }],
    [{ timer: { focusMin: 121 } }],
    [{ timer: { shortBreakMin: 31 } }],
    [{ timer: { longBreakMin: 4 } }],
    [{ timer: { cyclesBeforeLong: 7 } }],
    [{ planner: { newPerSessionMax: 31 } }],
    [{ planner: { backlogSpreadMinDays: 8, backlogSpreadMaxDays: 7 } }],
    [{ exercise: { hardMinScore: 0.9, goodMinScore: 0.8 } }],
  ])('rechaza %j', (input) => {
    expect(StudyConfigSchema.safeParse(input).success).toBe(false);
  });

  it('acepta los extremos de R2, LD8 y R7', () => {
    const r = StudyConfigSchema.safeParse({
      fsrs: { requestRetention: 0.95, projectionDays: 90 },
      timer: { focusMin: 120, shortBreakMin: 1, longBreakMin: 60, cyclesBeforeLong: 2 },
    });
    expect(r.success).toBe(true);
  });

  it('R2, R7: los rangos exportados para la UI son los del esquema', () => {
    const accepts = (input: object) => StudyConfigSchema.safeParse(input).success;
    expect(accepts({ fsrs: { requestRetention: RETENTION_RANGE.min } })).toBe(true);
    expect(accepts({ fsrs: { requestRetention: RETENTION_RANGE.max } })).toBe(true);
    expect(accepts({ fsrs: { requestRetention: RETENTION_RANGE.min - 0.01 } })).toBe(false);
    expect(accepts({ fsrs: { requestRetention: RETENTION_RANGE.max + 0.01 } })).toBe(false);
    for (const [key, range] of Object.entries(TIMER_RANGES)) {
      expect(accepts({ timer: { [key]: range.min } })).toBe(true);
      expect(accepts({ timer: { [key]: range.max } })).toBe(true);
      expect(accepts({ timer: { [key]: range.min - 1 } })).toBe(false);
      expect(accepts({ timer: { [key]: range.max + 1 } })).toBe(false);
    }
  });
});
