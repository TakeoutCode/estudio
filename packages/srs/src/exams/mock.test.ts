import { type Confidence, defaultStudyConfig, type MockItem } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { newCardState } from '../fsrs/scheduler.js';
import type { PlannerCard } from '../planner/queue.js';
import { DAY, NOW, range, reviewCard } from '../test/planner-fixtures.js';
import { buildMock, mockResults, mockTaken } from './mock.js';

const cfg = defaultStudyConfig();
const started = (n: number, topic: string): PlannerCard => ({ ...reviewCard(n, { topic }) });
const fresh = (n: number, topic: string): PlannerCard => ({
  state: newCardState(`0192f1a0-0000-7000-8222-${n.toString().padStart(12, '0')}`, NOW),
  topicId: topic,
  lapseBaseline: 0,
});
const exam = { date: NOW + 10 * DAY, topicIds: ['nervios', 'musculos'] };
const earlier = { date: NOW - 20 * DAY, topicIds: ['huesos'] };
const later = { date: NOW + 40 * DAY, topicIds: ['cardio'] };
const cards = [
  ...range(1, 20).map((n) => started(n, 'nervios')),
  ...range(100, 20).map((n) => started(n, 'musculos')),
  ...range(200, 20).map((n) => started(n, 'huesos')),
  ...range(300, 20).map((n) => started(n, 'cardio')),
  ...range(400, 10).map((n) => fresh(n, 'nervios')),
];
const topicOf = new Map(cards.map((c) => [c.state.cardId, c.topicId]));
const count = (questions: { topicId: string | null }[], topic: string) =>
  questions.filter((q) => q.topicId === topic).length;

describe('LD13: armar el simulacro', () => {
  const build = (patch: Partial<Parameters<typeof buildMock>[0]> = {}) =>
    buildMock({ exam, otherExams: [earlier, later], cards, cfg: cfg.exam, seed: 'sesion-1', ...patch });

  it('LD13: `mockSize` preguntas con `previousTopicsShare` de temas de exámenes anteriores', () => {
    const mock = build();
    expect(mock).toHaveLength(30);
    expect(count(mock, 'huesos')).toBe(9); // 30 × 0.3
    expect(count(mock, 'cardio')).toBe(0); // un examen posterior no es acumulado
    expect(new Set(mock.map((q) => q.cardId)).size).toBe(30);
  });

  it('AG4: tamaño y parte acumulada salen de la config', () => {
    expect(build({ cfg: { mockSize: 10, previousTopicsShare: 0 } })).toHaveLength(10);
    expect(count(build({ cfg: { mockSize: 10, previousTopicsShare: 0 } }), 'huesos')).toBe(0);
    expect(count(build({ cfg: { mockSize: 10, previousTopicsShare: 0.5 } }), 'huesos')).toBe(5);
  });

  it('no examina lo que nunca vio: solo tarjetas ya empezadas', () => {
    expect(build().every((q) => cards.find((c) => c.state.cardId === q.cardId)?.state.phase !== 'new')).toBe(
      true,
    );
  });

  it('si una parte no alcanza, la otra completa', () => {
    const few = [
      ...range(1, 5).map((n) => started(n, 'nervios')),
      ...range(200, 20).map((n) => started(n, 'huesos')),
    ];
    const mock = build({ cards: few, cfg: { mockSize: 12, previousTopicsShare: 0.3 } });
    expect(mock).toHaveLength(12);
    expect(count(mock, 'nervios')).toBe(5);
    expect(build({ cards: [], cfg: cfg.exam })).toEqual([]);
  });

  it('reparte entre los temas del examen antes de repetir uno', () => {
    const mock = build({ otherExams: [], cfg: { mockSize: 4, previousTopicsShare: 0 } });
    expect(count(mock, 'nervios')).toBe(2);
    expect(count(mock, 'musculos')).toBe(2);
  });

  it('AG3: misma semilla, mismo simulacro; otra semilla, otro', () => {
    expect(build()).toEqual(build());
    expect(build({ seed: 'sesion-2' }).map((q) => q.cardId)).not.toEqual(build().map((q) => q.cardId));
    expect(build().every((q) => topicOf.get(q.cardId) === q.topicId)).toBe(true);
  });
});

describe('§5, LD13: resultado por tema', () => {
  const item = (topicId: string, confidence: Confidence | null, correct: boolean | null): MockItem => ({
    cardId: '0192f1a0-0000-7000-8000-000000000001',
    topicId,
    confidence,
    answer: null,
    durationMs: 1_000,
    answeredAt: NOW,
    correct,
  });
  const items = [
    ...range(0, 6).map((i) => item('nervios', 3, i < 4)),
    ...range(0, 3).map((i) => item('huesos', 2, i < 1)),
    item('huesos', 2, null), // sin calificar
  ];

  it('§5: acierto por tema; con menos de `topicMinItems` preguntas, "pocos datos"', () => {
    const result = mockResults(items, null, cfg);
    expect(result).toMatchObject({ graded: 9, correct: 5 });
    expect(result.topics).toEqual([
      { topicId: 'nervios', graded: 6, correct: 4, fewData: false, previous: null },
      { topicId: 'huesos', graded: 3, correct: 1, fewData: true, previous: null },
    ]);
    const strict = { ...cfg, exam: { ...cfg.exam, topicMinItems: 7 } };
    expect(mockResults(items, null, strict).topics[0]?.fewData).toBe(true);
  });

  it('§5: tendencia frente al simulacro anterior del mismo examen', () => {
    const before = range(0, 5).map((i) => item('nervios', 2, i < 2));
    expect(mockResults(items, before, cfg).topics[0]?.previous).toEqual({ graded: 5, correct: 2 });
    expect(mockResults(items, before, cfg).topics[1]?.previous).toBeNull();
  });

  it('§5: la calibración aparece con suficientes respuestas', () => {
    expect(mockResults(items, null, cfg).calibration).toBeNull();
    const many = range(0, 20).map(() => item('nervios', 3, false));
    expect(mockResults(many, null, cfg).calibration?.tendency).toBe('over');
  });

  it('P7: un simulacro terminado cuenta para `mocksDue`; uno en curso no', () => {
    expect(mockTaken({ examId: 'e', finishedAt: NOW })).toEqual({ examId: 'e', takenAt: NOW });
    expect(mockTaken({ examId: 'e', finishedAt: null })).toBeNull();
  });
});
