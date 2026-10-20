import { NotificationPrefsSchema, Rating } from '@estudio/shared';
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
  TODAY_START,
  TZ,
} from '../test/planner-fixtures.js';
import { backoffState, type DecideInput, decideNotification } from './decide.js';
import { newStartedToday, reminderCandidates, reminderTimeCrossed } from './reminders.js';

const prefs = NotificationPrefsSchema.parse({ enabled: true, dailyReminderTime: '19:00' });
const at = (h: number, m = 0) => TODAY_START + h * HOUR + m * 60_000; // hora local en CDMX
const input = (patch: Partial<DecideInput> = {}): DecideInput => ({
  kind: 'daily_reminder',
  nowUtc: at(19),
  timeZone: TZ,
  prefs,
  remindersSentToday: 0,
  dueCount: 20,
  backoff: { active: false, lastReminderAt: null },
  ...patch,
});

describe('NT2: decideNotification', () => {
  it('NT-T1: 9 pendientes no avisan; 10, sí (`minDueForReminder`)', () => {
    expect(decideNotification(input({ dueCount: 9 }))).toEqual({ send: false, reason: 'below_min_due' });
    expect(decideNotification(input({ dueCount: 10 }))).toEqual({ send: true });
    const fewer = { ...prefs, minDueForReminder: 5 };
    expect(decideNotification(input({ dueCount: 9, prefs: fewer }))).toEqual({ send: true });
  });

  it.each([
    [21, 59, true],
    [22, 0, false],
    [24 + 6, 59, false],
    [24 + 7, 0, true],
  ])('NT-T2: a las %i:%i en CDMX se envía = %s (horas silenciosas 22:00-07:00)', (h, m, sends) => {
    expect(decideNotification(input({ nowUtc: at(h, m) })).send).toBe(sends);
  });

  it('NT-T3: el fin de descanso queda fuera del tope y de la reducción, pero respeta la noche', () => {
    const capped = input({
      kind: 'break_end',
      remindersSentToday: 2,
      backoff: { active: true, lastReminderAt: at(8) },
    });
    expect(decideNotification(capped)).toEqual({ send: true });
    expect(decideNotification({ ...capped, nowUtc: at(23) })).toEqual({ send: false, reason: 'quiet_hours' });
    const off = { ...prefs, breakEnd: { enabled: false } };
    expect(decideNotification({ ...capped, prefs: off })).toEqual({ send: false, reason: 'disabled' });
  });

  it('NT-T4: con `maxRemindersPerDay` enviados, `daily_cap`', () => {
    expect(decideNotification(input({ remindersSentToday: 2 }))).toEqual({
      send: false,
      reason: 'daily_cap',
    });
    expect(
      decideNotification(input({ remindersSentToday: 1, prefs: { ...prefs, maxRemindersPerDay: 1 } })),
    ).toEqual({
      send: false,
      reason: 'daily_cap',
    });
  });

  it('§3f: en modo reducido, uno cada `backoffEveryDays` días', () => {
    const recent = { active: true, lastReminderAt: at(19) - 2 * DAY };
    expect(decideNotification(input({ backoff: recent }))).toEqual({ send: false, reason: 'backoff' });
    expect(
      decideNotification(input({ backoff: { active: true, lastReminderAt: at(19) - 3 * DAY } })),
    ).toEqual({
      send: true,
    });
    expect(decideNotification(input({ backoff: recent, prefs: { ...prefs, backoffEveryDays: 2 } }))).toEqual({
      send: true,
    });
  });

  it('apagados: todo, el diario sin hora y el plan del día', () => {
    expect(decideNotification(input({ prefs: { ...prefs, enabled: false } })).send).toBe(false);
    expect(decideNotification(input({ prefs: { ...prefs, dailyReminderTime: null } }))).toEqual({
      send: false,
      reason: 'disabled',
    });
    const noPlan = { ...prefs, studyPlan: { enabled: false } };
    expect(decideNotification(input({ kind: 'study_plan', prefs: noPlan })).send).toBe(false);
    expect(decideNotification(input({ kind: 'exam_soon' })).send).toBe(true);
    expect(
      decideNotification(input({ kind: 'exam_soon', prefs: { ...prefs, examSoonDaysBefore: [] } })).send,
    ).toBe(false);
  });
});

describe('NT7, §3f: ignorados y reducción', () => {
  const sent = (h: number, opened: number | null = null) => ({
    sentAt: at(h),
    openedAt: opened === null ? null : at(opened),
  });

  it('NT-T5: 3 ignorados seguidos activan el modo reducido; abrir uno lo reinicia', () => {
    const three = [sent(-72), sent(-48), sent(-24)];
    expect(backoffState(three, at(0), prefs, null)).toMatchObject({ ignoredStreak: 3, active: true });
    const opened = [...three, sent(-12, -11)];
    expect(backoffState(opened, at(0), prefs, null)).toMatchObject({ ignoredStreak: 0, active: false });
  });

  it('NT7: el último cuenta como ignorado solo pasadas `ignoredAfterHours`', () => {
    const events = [sent(-72), sent(-48), sent(-2)];
    expect(backoffState(events, at(0), prefs, null)).toMatchObject({ ignoredStreak: 2, active: false });
    expect(backoffState(events, at(0), { ...prefs, ignoredAfterHours: 1 }, null).ignoredStreak).toBe(3);
    expect(backoffState(events, at(0), { ...prefs, ignoredStreakForBackoff: 2 }, null).active).toBe(true);
  });

  it('"Como antes" cuenta desde ahí; la última fecha de envío sigue siendo la real', () => {
    const three = [sent(-72), sent(-48), sent(-24)];
    expect(backoffState(three, at(0), prefs, at(-30))).toMatchObject({
      ignoredStreak: 1,
      active: false,
      lastReminderAt: at(-24),
    });
  });
});

describe('NT3: el tick que cruza su hora', () => {
  const MIN = 60_000;

  it('avisa en el tick que contiene las 19:00 locales y no en el siguiente', () => {
    expect(reminderTimeCrossed(at(18, 55), at(19), TZ, '19:00')).toBe(true);
    expect(reminderTimeCrossed(at(19), at(19, 5), TZ, '19:00')).toBe(false);
    expect(reminderTimeCrossed(at(18, 50), at(18, 55), TZ, '19:00')).toBe(false);
    expect(reminderTimeCrossed(at(19), at(19), TZ, '19:00')).toBe(false);
  });

  it('usa su zona, no la del servidor', () => {
    // 19:00 en CDMX (UTC-6) son las 01:00 UTC del día siguiente.
    expect(reminderTimeCrossed(at(18, 58), at(19, 2), 'UTC', '19:00')).toBe(false);
    expect(reminderTimeCrossed(at(12, 58), at(13, 2), 'UTC', '19:00')).toBe(true);
  });

  it('cruza la medianoche y no recupera un hueco de un día', () => {
    expect(reminderTimeCrossed(at(23, 58), at(24, 3), TZ, '00:00')).toBe(true);
    expect(reminderTimeCrossed(at(23, 58), at(24, 3), TZ, '23:59')).toBe(true);
    expect(reminderTimeCrossed(at(23, 58), at(24, 3), TZ, '19:00')).toBe(false);
    expect(reminderTimeCrossed(at(19), at(19) + DAY, TZ, '08:00')).toBe(true);
  });

  it('con cambio de horario (Nueva York, 8 de marzo de 2026: 02:00 → 03:00)', () => {
    const before = Date.UTC(2026, 2, 8, 6, 58); // 01:58 EST
    expect(reminderTimeCrossed(before, before + 5 * MIN, 'America/New_York', '03:00')).toBe(true);
    expect(reminderTimeCrossed(before + 5 * MIN, before + 10 * MIN, 'America/New_York', '03:00')).toBe(false);
  });
});

describe('NT3: qué recordatorios califican', () => {
  const cfg = cfgWith();
  const scheduler = createScheduler(cfg.fsrs);
  const base = {
    logs: [],
    config: cfg,
    scheduler,
    exams: [],
    notifiedExamDays: new Set<string>(),
    prefs,
    now: NOW,
    timeZone: TZ,
  };

  it('NT3: pendientes de hoy contadas como en Hoy, con los temas que más pesan', () => {
    const cards = [
      ...range(1, 5).map((n) => reviewCard(n, { topic: 'nervios' })),
      ...range(10, 2).map((n) => reviewCard(n, { topic: 'huesos' })),
      reviewCard(20, { due: NOW + 3 * DAY, topic: 'cardio' }),
    ];
    const result = reminderCandidates({ ...base, cards });
    expect(result.dueToday).toEqual({ count: 7, topicIds: ['nervios', 'huesos'] });
  });

  it('NT-T11: un aviso por examen y por cada N de `examSoonDaysBefore`', () => {
    const exams = [
      { id: 'parcial', date: TODAY_START + 7 * DAY, topicIds: ['nervios'] },
      { id: 'final', date: TODAY_START + 5 * DAY, topicIds: ['nervios'] },
    ];
    const cards = [reviewCard(1, { topic: 'nervios' })];
    expect(reminderCandidates({ ...base, cards, exams }).examSoon).toEqual([{ examId: 'parcial', days: 7 }]);
    expect(
      reminderCandidates({ ...base, cards, exams, notifiedExamDays: new Set(['parcial:7']) }).examSoon,
    ).toEqual([]);
  });

  it('NT-T12: el plan del día no avisa si ya completó la cuota sugerida', () => {
    const cards = range(1, 20).map((n) => newCard(n, 'nervios'));
    const exams = [{ id: 'parcial', date: TODAY_START + 10 * DAY, topicIds: ['nervios'] }];
    expect(reminderCandidates({ ...base, cards, exams }).studyPlan).toEqual({
      newToday: 2,
      topicIds: ['nervios'],
    });
    const started = [id(1), id(2)].map((cardId) => log(NOW - HOUR, Rating.Good, { type: 'learn', cardId }));
    expect(reminderCandidates({ ...base, cards, exams, logs: started }).studyPlan).toBeNull();
  });

  it('las nuevas de hoy son las tarjetas con su primer repaso hoy', () => {
    const logs = [
      log(NOW - HOUR, Rating.Good, { cardId: id(1) }),
      log(NOW - 2 * DAY, Rating.Good, { cardId: id(2) }),
      log(NOW - HOUR, Rating.Good, { cardId: id(2) }),
    ];
    expect(newStartedToday(logs, NOW, TZ)).toBe(1);
  });
});
