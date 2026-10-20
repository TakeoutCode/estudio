import { defaultStudyConfig, Rating, type TimerBlockLog } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import {
  cfgWith,
  DAY,
  HOUR,
  id,
  log,
  newCard,
  NOW,
  range,
  TODAY_START,
  TZ,
} from '../test/planner-fixtures.js';
import { nextCard } from './queue.js';
import { fatigueDetected, fatigueWarningDue, mocksDue, type StopInput, stopSuggestions } from './signals.js';

const planner = defaultStudyConfig().planner;

describe('P5: sugerir descanso', () => {
  // 10 primeras: todas bien, 5 s. 10 últimas: `recalled` bien, `ms` cada una.
  const session = (recalled: number, ms: number) => [
    ...range(0, 10).map((i) => log(NOW + i * 10_000, Rating.Good, { durationMs: 5_000 })),
    ...range(0, 10).map((i) =>
      log(NOW + HOUR + i * 10_000, i < recalled ? Rating.Good : Rating.Again, { durationMs: ms }),
    ),
  ];

  it('P5: acierto −20 puntos y mediana de tiempo ×1.5 frente al inicio', () => {
    expect(fatigueDetected(session(8, 7_500), planner)).toBe(true);
    expect(fatigueDetected(session(9, 7_500), planner)).toBe(false); // solo −10 puntos
    expect(fatigueDetected(session(8, 7_000), planner)).toBe(false); // ×1.4
  });

  it('AG4: caída, factor y ventana salen de la config', () => {
    const logs = session(8, 7_500);
    expect(fatigueDetected(logs, { ...planner, fatigueAccuracyDropPts: 30 })).toBe(false);
    expect(fatigueDetected(logs, { ...planner, fatigueLatencyFactor: 2 })).toBe(false);
    expect(fatigueDetected(logs, { ...planner, fatigueWindowCards: 11 })).toBe(false); // faltan respuestas
    expect(fatigueDetected(logs, { ...planner, fatigueWindowCards: 5 })).toBe(true);
  });

  it('P5: el orden de llegada de los logs no importa', () => {
    expect(fatigueDetected(session(8, 7_500).reverse(), planner)).toBe(true);
  });

  it('P5: tras un aviso o un descanso, el siguiente espera otra ventana de respuestas', () => {
    const tired = session(8, 7_500); // 20 respuestas
    const more = (n: number) =>
      range(0, n).map((i) => log(NOW + 2 * HOUR + i * 10_000, Rating.Again, { durationMs: 9_000 }));
    expect(fatigueWarningDue(tired, null, planner)).toBe(true); // primer aviso
    expect(fatigueWarningDue(tired, 20, planner)).toBe(false); // recién avisado
    expect(fatigueWarningDue([...tired, ...more(9)], 20, planner)).toBe(false);
    expect(fatigueWarningDue([...tired, ...more(10)], 20, planner)).toBe(true);
    // AG4: la ventana sale de la config.
    expect(fatigueWarningDue([...tired, ...more(5)], 20, { ...planner, fatigueWindowCards: 5 })).toBe(true);
  });

  it('P5: tras descansar, con respuestas nuevas que ya no muestran fatiga, no avisa', () => {
    const rested = range(0, 10).map((i) =>
      log(NOW + 2 * HOUR + i * 10_000, Rating.Good, { durationMs: 5_000 }),
    );
    expect(fatigueWarningDue([...session(8, 7_500), ...rested], 20, planner)).toBe(false);
  });
});

describe('P6: sugerir parar (nunca bloquear)', () => {
  const morning = NOW; // 09:00 en CDMX
  const block = (endedAt: number, outcome: TimerBlockLog['outcome'] = 'completed') =>
    ({ kind: 'focus', outcome, endedAt }) as const;
  const base: StopInput = {
    queueDone: false,
    blocks: [],
    fatigueWarningsInRow: 0,
    now: morning,
    timeZone: TZ,
    bedtime: null,
    quietHours: { start: '22:00', end: '07:00' },
    cfg: planner,
  };

  it('sin motivos no sugiere nada', () => {
    expect(stopSuggestions(base)).toEqual([]);
  });

  it('P6: cola y cuota de nuevas completas', () => {
    expect(stopSuggestions({ ...base, queueDone: true })).toEqual(['queue_done']);
  });

  it('P6: 4 bloques netos en su día; los interrumpidos y los de ayer no cuentan', () => {
    const today = range(0, 4).map((i) => block(TODAY_START + (i + 1) * HOUR));
    expect(stopSuggestions({ ...base, blocks: today })).toEqual(['blocks_done']);
    const mixed = [
      ...today.slice(0, 3),
      block(TODAY_START + 5 * HOUR, 'interrupted'),
      block(TODAY_START - 1),
    ];
    expect(stopSuggestions({ ...base, blocks: mixed })).toEqual([]);
    expect(stopSuggestions({ ...base, blocks: today, cfg: { ...planner, stopAfterNetBlocks: 5 } })).toEqual(
      [],
    );
  });

  it('P6: pasó su hora de dormir (o el inicio de las horas silenciosas si no la declaró)', () => {
    const at = (h: number) => TODAY_START + h * HOUR;
    expect(stopSuggestions({ ...base, now: at(22.5) })).toEqual(['bedtime']);
    expect(stopSuggestions({ ...base, now: at(21.5) })).toEqual([]);
    expect(stopSuggestions({ ...base, now: at(21.5), bedtime: '21:00' })).toEqual(['bedtime']);
    expect(stopSuggestions({ ...base, now: at(23), bedtime: '23:30' })).toEqual([]);
    expect(stopSuggestions({ ...base, now: at(24 + 2), bedtime: '23:30' })).toEqual(['bedtime']); // 02:00
    expect(stopSuggestions({ ...base, now: at(24 + 8) })).toEqual([]); // ya amaneció
  });

  it('P6: dos avisos de fatiga seguidos', () => {
    expect(stopSuggestions({ ...base, fatigueWarningsInRow: 2 })).toEqual(['fatigue']);
    expect(
      stopSuggestions({ ...base, fatigueWarningsInRow: 2, cfg: { ...planner, fatigueWarningsToStop: 3 } }),
    ).toEqual([]);
  });

  it('P6: con todos los motivos, la sesión sigue ofreciendo tarjetas', () => {
    const all = stopSuggestions({
      ...base,
      queueDone: true,
      blocks: range(0, 4).map((i) => block(TODAY_START + (i + 1) * HOUR)),
      fatigueWarningsInRow: 5,
      now: TODAY_START + 23 * HOUR,
    });
    expect(all).toEqual(['queue_done', 'blocks_done', 'bedtime', 'fatigue']);
    const queue = [{ cardId: id(1), topicId: null, kind: 'new' as const }];
    const states = new Map([[id(1), newCard(1).state]]);
    expect(nextCard(queue, states, NOW, NOW).kind).toBe('card');
  });
});

describe('P7: simulacros', () => {
  const exam = cfgWith().exam;
  const examIn = (weeks: number) => ({ examId: id(1), date: NOW + weeks * 7 * DAY });

  it('P7: con examen a menos de 8 semanas, uno por semana', () => {
    expect(mocksDue([examIn(4)], [], NOW, exam)).toEqual([{ examId: id(1), missing: 1 }]);
    expect(mocksDue([examIn(4)], [{ examId: id(1), takenAt: NOW - 3 * DAY }], NOW, exam)).toEqual([]);
    expect(mocksDue([examIn(4)], [{ examId: id(1), takenAt: NOW - 8 * DAY }], NOW, exam)).toHaveLength(1);
    expect(mocksDue([examIn(4)], [{ examId: id(2), takenAt: NOW - DAY }], NOW, exam)).toHaveLength(1);
  });

  it('P7: exámenes lejanos o pasados no piden simulacro', () => {
    expect(mocksDue([examIn(9)], [], NOW, exam)).toEqual([]);
    expect(mocksDue([examIn(-1)], [], NOW, exam)).toEqual([]);
  });

  it('AG4: semanas y simulacros por semana salen de la config', () => {
    expect(mocksDue([examIn(9)], [], NOW, { ...exam, mockWeeksBeforeExam: 10 })).toHaveLength(1);
    const oneTaken = [{ examId: id(1), takenAt: NOW - DAY }];
    expect(mocksDue([examIn(4)], oneTaken, NOW, { ...exam, mocksPerWeek: 2 })).toEqual([
      { examId: id(1), missing: 1 },
    ]);
    expect(mocksDue([examIn(4)], [], NOW, { ...exam, mocksPerWeek: 0 })).toEqual([]);
  });
});
