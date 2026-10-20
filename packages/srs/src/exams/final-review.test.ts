import { defaultStudyConfig } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { createScheduler } from '../fsrs/scheduler.js';
import {
  cfgWith,
  DAY,
  HOUR,
  id,
  newCard,
  NOW,
  range,
  reviewCard,
  TODAY_START,
  TZ,
} from '../test/planner-fixtures.js';
import { finalReviewQueue } from './final-review.js';

const cfg = defaultStudyConfig();
const scheduler = createScheduler(cfg.fsrs);
const examIn = (days: number) => ({ date: TODAY_START + days * DAY, topicIds: ['nervios', 'huesos'] });

/** Aprendida, repasada por última vez hace un mes (antes de cualquier ventana). */
const learned = (n: number, opts: Parameters<typeof reviewCard>[1]) => {
  const card = reviewCard(n, opts);
  return { ...card, state: { ...card.state, lastReview: NOW - 30 * DAY } };
};

describe('LD12: repaso previo al examen', () => {
  const exam = examIn(5);
  const afterExam = exam.date + 10 * DAY;

  it('LD12: lo del alcance que FSRS programó para después del examen; no lo que vence antes', () => {
    const cards = [
      learned(1, { due: afterExam, topic: 'nervios' }),
      learned(2, { due: exam.date - DAY, topic: 'nervios' }), // vence antes: va en los repasos normales
      learned(3, { due: afterExam, topic: 'cardio' }), // fuera del alcance
      learned(4, { due: afterExam, topic: 'huesos', lapses: 6 }), // para reformular (P3)
      newCard(5, 'nervios'), // nunca vista
    ];
    expect(finalReviewQueue(exam, cards, scheduler, NOW, TZ, cfg).map((q) => q.cardId)).toEqual([id(1)]);
  });

  it('LD12: solo en los últimos `finalReviewWindowDays` días (y el día del examen)', () => {
    const card = (e: { date: number }) => [learned(1, { due: e.date + 10 * DAY, topic: 'nervios' })];
    expect(finalReviewQueue(examIn(7), card(examIn(7)), scheduler, NOW, TZ, cfg)).toHaveLength(0);
    expect(finalReviewQueue(examIn(6), card(examIn(6)), scheduler, NOW, TZ, cfg)).toHaveLength(1);
    expect(finalReviewQueue(examIn(0), card(examIn(0)), scheduler, NOW, TZ, cfg)).toHaveLength(1);
    expect(finalReviewQueue(examIn(-1), card(examIn(-1)), scheduler, NOW, TZ, cfg)).toHaveLength(0);
    const wide = { ...cfg, exam: { ...cfg.exam, finalReviewWindowDays: 10 } };
    expect(finalReviewQueue(examIn(7), card(examIn(7)), scheduler, NOW, TZ, wide)).toHaveLength(1);
  });

  it('LD12: es una sola vuelta: lo repasado desde que empezó la ventana no vuelve', () => {
    const reviewedInWindow = learned(1, { due: afterExam, topic: 'nervios', stability: 20 });
    const state = { ...reviewedInWindow.state, lastReview: NOW - HOUR };
    expect(finalReviewQueue(exam, [{ ...reviewedInWindow, state }], scheduler, NOW, TZ, cfg)).toHaveLength(0);
  });

  it('§3 y P4: menor retrievability primero y sin rachas largas del mismo tema', () => {
    const cards = [
      ...range(1, 7).map((n) => learned(n, { due: afterExam, topic: 'nervios', stability: 5 + n })),
      learned(50, { due: afterExam, topic: 'huesos', stability: 100 }),
    ];
    const queue = finalReviewQueue(exam, cards, scheduler, NOW, TZ, cfg);
    expect(queue[0]?.cardId).toBe(id(1)); // la de menor estabilidad
    expect(queue[5]?.topicId).toBe('huesos'); // corta la racha de `reviewMaxSameTopicRun`
    expect(
      finalReviewQueue(exam, cards, scheduler, NOW, TZ, cfgWith({ reviewMaxSameTopicRun: 7 }))[5]?.topicId,
    ).toBe('nervios');
  });
});
