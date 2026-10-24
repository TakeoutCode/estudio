import { defaultStudyConfig } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { cfgWith, DAY, NOW, range, reviewCard, TODAY_START, TZ } from '../test/planner-fixtures.js';
import { newCardState } from '../fsrs/scheduler.js';
import type { PlannerCard } from '../planner/queue.js';
import { examPlan, upcomingExamTopics } from './plan.js';

const fresh = (n: number, topic: string): PlannerCard => ({
  state: newCardState(`0192f1a0-0000-7000-8222-${n.toString().padStart(12, '0')}`, NOW - DAY),
  topicId: topic,
  lapseBaseline: 0,
});
const exam = (inDays: number, topicIds = ['nervios', 'huesos']) => ({
  id: 'parcial',
  date: TODAY_START + inDays * DAY, // inicio del día local del examen
  topicIds,
});
const cards = [
  ...range(1, 25).map((n) => fresh(n, 'nervios')),
  ...range(100, 5).map((n) => fresh(n, 'huesos')),
  reviewCard(500, { topic: 'nervios' }),
  reviewCard(501, { topic: 'nervios', lapses: 6 }), // para reformular: no cuenta
  fresh(900, 'otro tema'),
];
const cfg = defaultStudyConfig();

describe('R11, LD11: plan hacia el examen', () => {
  it('LD11: por tema, las nuevas que faltan; ⌈faltan / días⌉ por día', () => {
    const plan = examPlan(exam(10), cards, NOW, TZ, cfg);
    expect(plan.topics).toEqual([
      { topicId: 'nervios', newRemaining: 25, started: 1 },
      { topicId: 'huesos', newRemaining: 5, started: 0 },
    ]);
    expect(plan).toMatchObject({
      daysLeft: 10,
      newRemaining: 30,
      suggestedNewPerDay: 3,
      beyondCap: 0,
      past: false,
    });
  });

  it('P1: la sugerencia no pasa el tope de nuevas por sesión, y dice cuántas no alcanzan', () => {
    const plan = examPlan(exam(2), cards, NOW, TZ, cfg);
    expect(plan).toMatchObject({ suggestedNewPerDay: 10, beyondCap: 10 });
    const wider = examPlan(exam(2), cards, NOW, TZ, cfgWith({ newPerSessionMax: 30 }));
    expect(wider).toMatchObject({ suggestedNewPerDay: 15, beyondCap: 0 });
  });

  it('el día del examen no quedan días para nuevas; después, pasó', () => {
    expect(examPlan(exam(0), cards, NOW, TZ, cfg)).toMatchObject({
      daysLeft: 0,
      suggestedNewPerDay: 0,
      beyondCap: 30,
      past: false,
    });
    expect(examPlan(exam(-1), cards, NOW, TZ, cfg)).toMatchObject({
      daysLeft: 0,
      past: true,
      inFinalWindow: false,
    });
  });

  it('LD12: la ventana final son los últimos `finalReviewWindowDays` días', () => {
    expect(examPlan(exam(6), cards, NOW, TZ, cfg).inFinalWindow).toBe(true);
    expect(examPlan(exam(7), cards, NOW, TZ, cfg).inFinalWindow).toBe(false);
    const wide = { ...cfg, exam: { ...cfg.exam, finalReviewWindowDays: 10 } };
    expect(examPlan(exam(7), cards, NOW, TZ, wide).inFinalWindow).toBe(true);
  });

  it('AG6: los días son de su calendario, con o sin horario de verano', () => {
    // Nueva York deja el horario de verano el 1 de noviembre de 2026.
    const now = Date.UTC(2026, 9, 31, 3); // viernes 30, 23:00 EDT
    const date = Date.UTC(2026, 10, 2, 5); // lunes 2, 00:00 EST
    expect(examPlan({ ...exam(0), date }, cards, now, 'America/New_York', cfg).daysLeft).toBe(3);
  });
});

describe('R11: temas de los próximos exámenes', () => {
  it('R11: del examen más próximo al más lejano, sin repetir ni contar los que pasaron', () => {
    const exams = [
      { date: TODAY_START + 20 * DAY, topicIds: ['vasos', 'nervios'] },
      { date: TODAY_START + 5 * DAY, topicIds: ['nervios', 'huesos'] },
      { date: TODAY_START - DAY, topicIds: ['carpo'] }, // ayer: ya pasó
    ];
    expect(upcomingExamTopics(exams, NOW, TZ)).toEqual(['nervios', 'huesos', 'vasos']);
    expect(upcomingExamTopics([], NOW, TZ)).toEqual([]);
  });

  it('AG6: un examen hoy, en su día local, todavía cuenta', () => {
    const today = [{ date: TODAY_START, topicIds: ['huesos'] }];
    expect(upcomingExamTopics(today, TODAY_START + DAY - 60_000, TZ)).toEqual(['huesos']); // 23:59
    expect(upcomingExamTopics(today, TODAY_START + DAY + 60_000, TZ)).toEqual([]); // 00:01 del día siguiente
  });
});
