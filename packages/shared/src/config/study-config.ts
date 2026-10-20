import { z } from 'zod';

// Umbrales de estudio (AGENTS AG4). Cada clave cita su regla de docs/STUDY-METHODS.md:
//   "hipótesis"             = valor inicial de STUDY-METHODS, a calibrar con sus datos (§4, §6).
//   "diseño · sin evidencia" = decisión propia, no sale de STUDY-METHODS.
// Los `default()` son los valores iniciales; las secciones usan `prefault({})` para que
// `StudyConfigSchema.parse({})` complete todo (en zod 4, `default` no vuelve a parsear).

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const share = () => z.number().min(0).max(1);

export const FsrsConfigSchema = z.object({
  requestRetention: z.number().min(0.8).max(0.95).default(0.9), // R2
  maximumIntervalDays: int(1, 36500).default(36500), // diseño · sin evidencia (valor de fábrica de ts-fsrs)
  enableFuzz: z.boolean().default(true), // diseño · fuzz con semilla determinista (ARC5)
});

export const PlannerConfigSchema = z
  .object({
    newPerSessionMax: int(0, 30).default(10), // P1 · hipótesis
    bootstrapReviewSec: int(1, 600).default(20), // P1 · hipótesis
    bootstrapNewSec: int(1, 1800).default(60), // P1 · hipótesis
    overdueFactorForZeroNew: z.number().min(1).max(5).default(2), // P2 · hipótesis
    lowRetentionWindowDays: int(1, 14).default(3), // P3 · hipótesis
    lowRetentionDropPts: int(1, 50).default(10), // P3 · hipótesis
    leechLapses: int(2, 20).default(6), // P3 · hipótesis
    lowRetentionPersistDays: int(2, 30).default(7), // P3 · hipótesis
    persistNewFactor: share().default(0.5), // P3 · hipótesis
    reviewMaxSameTopicRun: int(1, 50).default(5), // P4 · hipótesis
    newMaxSameTopicRun: int(1, 50).default(10), // P4 · hipótesis
    fatigueWindowCards: int(5, 50).default(10), // P5 · hipótesis
    fatigueAccuracyDropPts: int(1, 100).default(20), // P5 · hipótesis
    fatigueLatencyFactor: z.number().min(1).max(5).default(1.5), // P5 · hipótesis
    stopAfterNetBlocks: int(1, 20).default(4), // P6 · hipótesis
    fatigueWarningsToStop: int(1, 10).default(2), // P6 · hipótesis
    backlogSpreadMinDays: int(1, 30).default(3), // P8 · hipótesis
    backlogSpreadMaxDays: int(1, 30).default(7), // P8 · hipótesis
  })
  .refine((c) => c.backlogSpreadMinDays <= c.backlogSpreadMaxDays, {
    path: ['backlogSpreadMinDays'],
    message: 'backlog_spread_min_gt_max',
  });

export const TimerModeSchema = z.enum(['structured', 'flexible', 'free']); // R8
export type TimerMode = z.infer<typeof TimerModeSchema>;

export const TimerConfigSchema = z.object({
  focusMin: int(5, 120).default(25), // R7 · 25 por ser el más estudiado con estudiantes, no por óptimo (R17)
  shortBreakMin: int(1, 30).default(5), // R7
  longBreakMin: int(5, 60).default(20), // R7, §3
  cyclesBeforeLong: int(2, 6).default(4), // R7
  mode: TimerModeSchema.default('flexible'), // R8 · diseño · sin evidencia
  pauseTimeoutMin: int(1, 120).default(10), // §3 · hipótesis
  endOfBlockGraceSec: int(0, 300).default(60), // §3, R13 · hipótesis
  flexExtendMin: int(1, 30).default(5), // §3 · hipótesis
});

/** Presets de §3. Ninguno se presenta como óptimo (R17); 50/10 y 90/20 son solo analogía. */
export const TIMER_PRESETS = [
  { id: '25-5', focusMin: 25, shortBreakMin: 5 },
  { id: '24-6', focusMin: 24, shortBreakMin: 6 },
  { id: '12-3', focusMin: 12, shortBreakMin: 3 },
  { id: '50-10', focusMin: 50, shortBreakMin: 10 },
  { id: '90-20', focusMin: 90, shortBreakMin: 20 },
] as const;

export const MetricsConfigSchema = z.object({
  inactivityCutoffSec: int(10, 600).default(90), // R21 · diseño sin fuente empírica
  minReviewsToShow: int(0, 1000).default(100), // §5 · diseño
  baselineWeeks: int(1, 12).default(4), // §5 · diseño · sin evidencia
  visible: z
    .object({
      activeTime: z.boolean().default(true), // §5: cada métrica se puede apagar
      retention: z.boolean().default(true),
      improveList: z.boolean().default(true),
      calibration: z.boolean().default(true),
      load: z.boolean().default(true),
      mockExams: z.boolean().default(true),
      sleep: z.boolean().default(false), // §5: opcional
    })
    .prefault({}),
});

export const ReviewConfigSchema = z.object({
  askConfidence: z.boolean().default(false), // R6: opcional en repasos
});

export const ExamConfigSchema = z.object({
  affectsScheduling: z.boolean().default(true), // P7 · confirmado por el responsable (ADR-009)
  highConfidenceMin: int(1, 3).default(3), // P7 · confirmado: la confianza 2 cuenta como poca
  feedbackTiming: z.enum(['end', 'immediate']).default('end'), // P7 [15]
  mockWeeksBeforeExam: int(1, 52).default(8), // P7 · hipótesis
  mocksPerWeek: int(0, 7).default(1), // P7 · hipótesis
  mockSize: int(5, 200).default(30), // diseño · sin evidencia
  previousTopicsShare: share().default(0.3), // diseño · sin evidencia
  finalReviewWindowDays: int(1, 30).default(7), // R11 · diseño · sin evidencia (LD12)
});

export const ExerciseConfigSchema = z
  .object({
    goodMinScore: share().default(1), // diseño · sin evidencia (LD2)
    hardMinScore: share().default(0.8), // diseño · sin evidencia (LD2)
  })
  .refine((c) => c.hardMinScore <= c.goodMinScore, { path: ['hardMinScore'], message: 'hard_gt_good' });

export const StudyConfigSchema = z.object({
  fsrs: FsrsConfigSchema.prefault({}),
  planner: PlannerConfigSchema.prefault({}),
  timer: TimerConfigSchema.prefault({}),
  metrics: MetricsConfigSchema.prefault({}),
  review: ReviewConfigSchema.prefault({}),
  exam: ExamConfigSchema.prefault({}),
  exercise: ExerciseConfigSchema.prefault({}),
});

export type StudyConfig = z.output<typeof StudyConfigSchema>;
export type FsrsConfig = StudyConfig['fsrs'];
export type PlannerConfig = StudyConfig['planner'];
export type TimerConfig = StudyConfig['timer'];
export type ExamConfig = StudyConfig['exam'];
export type ExerciseConfig = StudyConfig['exercise'];

/** Configuración con todos los valores iniciales de STUDY-METHODS. */
export const defaultStudyConfig = (): StudyConfig => StudyConfigSchema.parse({});
