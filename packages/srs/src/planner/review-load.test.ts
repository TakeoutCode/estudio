import {
  defaultStudyConfig,
  type FsrsConfig,
  Rating,
  type ReviewLog,
  type StudyConfig,
} from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { createScheduler } from '../fsrs/scheduler.js';
import {
  cfgWith,
  DAY,
  HOUR,
  id,
  log,
  newCard,
  NOW,
  range,
  reviewCard,
  TZ,
} from '../test/planner-fixtures.js';
import type { PlannerCard } from './queue.js';
import { type LoadCard, projectReviewLoad, simulateReviewLoad } from './review-load.js';

const withFsrs = (fsrs: Partial<FsrsConfig>, base: StudyConfig = defaultStudyConfig()): StudyConfig => ({
  ...base,
  fsrs: { ...base.fsrs, ...fsrs },
});

const simulate = (
  cards: readonly PlannerCard[],
  { config = defaultStudyConfig(), now = NOW, timeZone = TZ } = {},
) => simulateReviewLoad({ cards, scheduler: createScheduler(config.fsrs), config, now, timeZone });

/** Repasos totales del horizonte (el promedio por los días simulados). */
const total = (load: { reviewsPerDay: number; days: number }) => Math.round(load.reviewsPerDay * load.days);

// 80 tarjetas con historias distintas: aprendidas hace 10 a 60 días, con algún "Otra vez".
const studied: LoadCard[] = range(1, 80).map((n) => ({
  cardId: id(n),
  createdAt: NOW - 60 * DAY + n,
  lapseBaseline: 0,
}));
const studiedLogs: ReviewLog[] = studied.flatMap(({ cardId }, i) => {
  const start = NOW - (10 + (i % 50)) * DAY;
  return [
    log(start, Rating.Good, { type: 'learn', cardId }),
    log(start + 600_000, Rating.Good, { type: 'learn', cardId }),
    log(start + (1 + (i % 3)) * DAY, i % 5 === 0 ? Rating.Again : Rating.Good, { cardId }),
    log(start + (5 + (i % 4)) * DAY, Rating.Good, { cardId }),
  ];
});
const project = (config: StudyConfig, logs = studiedLogs, cards = studied) =>
  projectReviewLoad({ cards, logs, config, now: NOW, timeZone: TZ });

describe('R2, LD8: carga proyectada', () => {
  it('R2: más retención objetivo, más repasos al día', () => {
    const at = (requestRetention: number) => project(withFsrs({ requestRetention })).reviewsPerDay;
    expect(at(0.8)).toBeLessThan(at(0.9));
    expect(at(0.9)).toBeLessThan(at(0.95));
    expect(project(withFsrs({ requestRetention: 0.95 })).requestRetention).toBe(0.95);
  });

  it('LD8: es determinista y no depende del orden de llegada del log ni de las tarjetas', () => {
    const config = defaultStudyConfig();
    const once = project(config);
    expect(project(config, [...studiedLogs].reverse(), [...studied].reverse())).toEqual(once);
    expect(once.reviewsPerDay).toBeGreaterThan(0);
  });

  it('ADR-009: sin `affectsScheduling`, un simulacro no cuenta como repaso aprendido', () => {
    const cardId = id(1);
    const exams = [
      log(NOW - 20 * DAY, Rating.Good, { type: 'exam', cardId }),
      log(NOW - 10 * DAY, Rating.Good, { type: 'exam', cardId }),
    ];
    const cards = [{ cardId, createdAt: NOW - 30 * DAY, lapseBaseline: 0 }];
    const off = (base: StudyConfig) => ({ ...base, exam: { ...base.exam, affectsScheduling: false } });
    const noNew = cfgWith({ newPerSessionMax: 0 });
    expect(project(noNew, exams, cards).reviewsPerDay).toBeGreaterThan(0);
    expect(project(off(noNew), exams, cards).reviewsPerDay).toBe(0); // sigue nueva y no entra
  });

  it('sin tarjetas, cero', () => {
    expect(simulate([]).reviewsPerDay).toBe(0);
  });
});

describe('LD8: días simulados (`fsrs.projectionDays`)', () => {
  // Estabilidad alta: tras repasarla, la siguiente cae fuera de cualquier horizonte.
  const dueIn = (days: number) => reviewCard(1, { due: NOW + days * DAY, stability: 400 });

  it('cuenta solo lo que vence dentro del horizonte (mínimo 7, inicial 30, máximo 90)', () => {
    const card = [dueIn(20)];
    expect(simulate(card, { config: withFsrs({ projectionDays: 7 }) })).toMatchObject({
      days: 7,
      reviewsPerDay: 0,
    });
    expect(total(simulate(card))).toBeGreaterThan(0);
    expect(simulate(card).days).toBe(30);
    const ninety = simulate([dueIn(80)], { config: withFsrs({ projectionDays: 90 }) });
    expect(total(ninety)).toBeGreaterThan(0);
    expect(total(simulate([dueIn(80)]))).toBe(0);
  });

  it('lo pendiente se repasa hoy', () => {
    const overdue = reviewCard(1, { due: NOW - 5 * DAY, stability: 400 });
    expect(total(simulate([overdue], { config: withFsrs({ projectionDays: 7 }) }))).toBeGreaterThan(0);
  });

  const seven = withFsrs({ projectionDays: 7 });
  const dueAt = (due: number) => [reviewCard(1, { due, stability: 400 })];

  it('AG6: el horizonte termina a medianoche de su zona, no de la del servidor', () => {
    // 21:00 del lunes 26 en CDMX = 04:00 del martes 27 en Madrid.
    const due = Date.UTC(2026, 9, 27, 3);
    expect(total(simulate(dueAt(due), { config: seven }))).toBeGreaterThan(0);
    expect(total(simulate(dueAt(due), { config: seven, timeZone: 'Europe/Madrid' }))).toBe(0);
  });

  it('AG6: con `now` justo antes o después de medianoche, el horizonte se mueve un día', () => {
    const due = Date.UTC(2026, 9, 27, 12); // martes 27, 06:00 en CDMX
    const beforeMidnight = Date.UTC(2026, 9, 21, 5, 59); // 23:59 del martes 20
    const afterMidnight = Date.UTC(2026, 9, 21, 6, 1); // 00:01 del miércoles 21
    expect(total(simulate(dueAt(due), { config: seven, now: beforeMidnight }))).toBe(0);
    expect(total(simulate(dueAt(due), { config: seven, now: afterMidnight }))).toBeGreaterThan(0);
  });

  it('AG6: un día de 25 horas (fin del horario de verano) cuenta como un día', () => {
    // Nueva York deja el horario de verano el domingo 1 de noviembre de 2026.
    const now = Date.UTC(2026, 9, 30, 16); // viernes 30, 12:00 EDT
    const options = { config: seven, now, timeZone: 'America/New_York' };
    const lastEvening = Date.UTC(2026, 10, 6, 4, 30); // jueves 5, 23:30 EST
    const nextMorning = Date.UTC(2026, 10, 6, 5, 30); // viernes 6, 00:30 EST
    expect(total(simulate(dueAt(lastEvening), options))).toBeGreaterThan(0);
    expect(total(simulate(dueAt(nextMorning), options))).toBe(0);
  });
});

describe('P1: las nuevas entran con el tope por sesión', () => {
  const fresh = range(1, 60).map((n) => newCard(n));

  it('P1: con tope 0 no entra ninguna; con más tope entran antes y suman más repasos', () => {
    const at = (newPerSessionMax: number) =>
      total(simulate(fresh, { config: cfgWith({ newPerSessionMax }) }));
    expect(at(0)).toBe(0);
    expect(at(10)).toBeGreaterThan(0);
    expect(at(30)).toBeGreaterThan(at(10));
  });
});

describe('P3: las de "reformular" no se repiten', () => {
  const leech = (lapseBaseline = 0) => reviewCard(1, { due: NOW - HOUR, lapses: 6, lapseBaseline });

  it('P3: con `leechLapses` lapsos queda fuera; con otro umbral o tras reformular, cuenta', () => {
    expect(simulate([leech()]).reviewsPerDay).toBe(0);
    expect(simulate([leech()], { config: cfgWith({ leechLapses: 7 }) }).reviewsPerDay).toBeGreaterThan(0);
    expect(simulate([leech(1)]).reviewsPerDay).toBeGreaterThan(0);
  });
});
