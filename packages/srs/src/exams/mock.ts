import type { Exam, ExamConfig, MetricsConfig, MockItem, StudyConfig } from '@estudio/shared';
import { type Calibration, calibrationOf } from '../metrics/weekly.js';
import type { PlannerCard } from '../planner/queue.js';
import { unitHash } from '../util/hash.js';

// Simulacros (STUDY-METHODS P7; LEARNING-DESIGN LD13): acumulativos, con confianza
// obligatoria y resultado por tema, sin nota de aprobado ni comparación con nadie.

export interface MockQuestion {
  readonly cardId: string;
  readonly topicId: string | null;
}

export interface BuildMockInput {
  readonly exam: Pick<Exam, 'date' | 'topicIds'>;
  /** Otros exámenes: los anteriores a este aportan sus temas (acumulativo, P7). */
  readonly otherExams: readonly Pick<Exam, 'date' | 'topicIds'>[];
  readonly cards: readonly Pick<PlannerCard, 'state' | 'topicId'>[];
  readonly cfg: Pick<ExamConfig, 'mockSize' | 'previousTopicsShare'>;
  /** Misma semilla, mismo simulacro (AG3): el id de la sesión. */
  readonly seed: string;
}

/**
 * LD13: hasta `mockSize` preguntas de tarjetas ya empezadas (no se examina lo que nunca vio),
 * con `previousTopicsShare` de temas de exámenes anteriores. Si una parte no alcanza, la otra
 * completa. Dentro de cada parte se reparten entre temas y el orden final queda mezclado (P4).
 */
export function buildMock(input: BuildMockInput): MockQuestion[] {
  const { cfg, seed } = input;
  const current = new Set(input.exam.topicIds);
  const previous = new Set(
    input.otherExams
      .filter((e) => e.date < input.exam.date)
      .flatMap((e) => e.topicIds)
      .filter((id) => !current.has(id)),
  );
  const started = input.cards.filter((c) => c.state.phase !== 'new' && c.topicId !== null);
  const pool = (topics: ReadonlySet<string>) =>
    spread(
      started.filter((c) => c.topicId !== null && topics.has(c.topicId)),
      seed,
    );
  const fromCurrent = pool(current);
  const fromPrevious = pool(previous);

  const wantPrevious = Math.min(fromPrevious.length, Math.round(cfg.mockSize * cfg.previousTopicsShare));
  const takeCurrent = Math.min(fromCurrent.length, cfg.mockSize - wantPrevious);
  const takePrevious = Math.min(fromPrevious.length, cfg.mockSize - takeCurrent);
  return [...fromCurrent.slice(0, takeCurrent), ...fromPrevious.slice(0, takePrevious)].sort(
    (a, b) => unitHash(`${seed}:orden:${a.cardId}`) - unitHash(`${seed}:orden:${b.cardId}`),
  );
}

/** Orden con semilla y por turnos entre temas, para cubrir todos antes de repetir uno. */
function spread(cards: readonly Pick<PlannerCard, 'state' | 'topicId'>[], seed: string): MockQuestion[] {
  const byTopic = new Map<string | null, MockQuestion[]>();
  const shuffled = [...cards].sort(
    (a, b) => unitHash(`${seed}:${a.state.cardId}`) - unitHash(`${seed}:${b.state.cardId}`),
  );
  for (const card of shuffled) {
    const list = byTopic.get(card.topicId) ?? [];
    list.push({ cardId: card.state.cardId, topicId: card.topicId });
    byTopic.set(card.topicId, list);
  }
  const lists = [...byTopic.values()];
  const out: MockQuestion[] = [];
  for (let round = 0; out.length < cards.length; round += 1) {
    for (const list of lists) {
      const next = list[round];
      if (next) out.push(next);
    }
  }
  return out;
}

export interface TopicResult {
  readonly topicId: string | null;
  readonly graded: number;
  readonly correct: number;
  /** UX9: con menos de `topicMinItems` preguntas, "pocos datos". */
  readonly fewData: boolean;
  /** Tendencia (§5): el mismo tema en el simulacro anterior de este examen, si hubo. */
  readonly previous: { readonly graded: number; readonly correct: number } | null;
  /**
   * §5 "acierto y calibración por tema": la tendencia de su confianza en ese tema, desde
   * `topicMinItems` preguntas (con menos, null: "pocos datos"). Con tan pocas respuestas la
   * resolución sería ruido, así que solo se muestra la tendencia.
   */
  readonly calibration: Calibration['tendency'] | null;
}

export interface MockResult {
  readonly graded: number;
  readonly correct: number;
  readonly topics: readonly TopicResult[];
  /** §5, LD13: calibración del simulacro; null con pocas respuestas. */
  readonly calibration: Calibration | null;
}

type Graded = MockItem & {
  readonly confidence: NonNullable<MockItem['confidence']>;
  readonly correct: boolean;
};
const graded = (items: readonly MockItem[]): Graded[] =>
  items.filter((i): i is Graded => i.confidence !== null && i.correct !== null);

/** §5 y LD13: acierto y calibración por tema, sin nota de aprobado. */
export function mockResults(
  items: readonly MockItem[],
  previousItems: readonly MockItem[] | null,
  cfg: Pick<StudyConfig, 'exam'> & {
    readonly metrics: Pick<
      MetricsConfig,
      'calibrationMinSamples' | 'calibrationBiasMargin' | 'calibrationResolutionMin'
    >;
  },
): MockResult {
  const done = graded(items);
  const before = previousItems ? graded(previousItems) : [];
  const topicIds = [...new Set(done.map((i) => i.topicId))];
  const inTopic = (list: readonly Graded[], topicId: string | null) =>
    list.filter((i) => i.topicId === topicId);
  const tally = (list: readonly Graded[], topicId: string | null) => {
    const items = inTopic(list, topicId);
    return { graded: items.length, correct: items.filter((i) => i.correct).length };
  };
  const topicCalibration = { ...cfg.metrics, calibrationMinSamples: cfg.exam.topicMinItems };
  return {
    graded: done.length,
    correct: done.filter((i) => i.correct).length,
    topics: topicIds.map((topicId) => {
      const now = tally(done, topicId);
      const prev = tally(before, topicId);
      return {
        topicId,
        ...now,
        fewData: now.graded < cfg.exam.topicMinItems,
        previous: prev.graded > 0 ? prev : null,
        calibration: calibrationOf(inTopic(done, topicId), topicCalibration)?.tendency ?? null,
      };
    }),
    calibration: calibrationOf(done, cfg.metrics),
  };
}

/** P7: lo que `mocksDue` necesita de cada simulacro terminado. */
export const mockTaken = (session: { readonly examId: string; readonly finishedAt: number | null }) =>
  session.finishedAt === null ? null : { examId: session.examId, takenAt: session.finishedAt };
