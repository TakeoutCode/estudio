import { PlannerConfigSchema, Rating, StudyConfigSchema } from '@estudio/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CardState, createScheduler } from '../fsrs/scheduler.js';
import {
  cfgWith,
  DAY,
  dayOfReviews,
  HOUR,
  id,
  input,
  log,
  newCard,
  NOW,
  range,
  reviewCard,
  TODAY_START,
  TZ,
} from '../test/planner-fixtures.js';
import {
  buildSessionQueue,
  limitTopicRuns,
  loadSummary,
  needsTopicIntro,
  nextCard,
  type QueueItem,
} from './queue.js';

const news = (plan: { queue: readonly QueueItem[] }) => plan.queue.filter((q) => q.kind === 'new');
const reviews = (plan: { queue: readonly QueueItem[] }) => plan.queue.filter((q) => q.kind === 'review');
const manyNew = range(1000, 60).map((n) => newCard(n));

describe('P1: nuevas por sesión', () => {
  it('P1: con los tiempos de arranque, min(tope, ⌊(presupuesto − vencidas × 20 s) / 60 s⌋)', () => {
    const cards = [...range(1, 10).map((n) => reviewCard(n)), ...manyNew];
    // Presupuesto 25 min = 1500 s; 10 repasos = 200 s; sobran 1300 s → 21 nuevas.
    const plan = buildSessionQueue(input({ cards }));
    expect(plan.timing).toMatchObject({ reviewMs: 20_000, newMs: 60_000, reviewFromHistory: false });
    expect(news(plan)).toHaveLength(10); // tope por defecto
    const uncapped = buildSessionQueue(input({ cards, config: cfgWith({ newPerSessionMax: 30 }) }));
    expect(news(uncapped)).toHaveLength(21);
    const short = cfgWith({}, { timer: { ...cfgWith().timer, focusMin: 5 } });
    expect(news(buildSessionQueue(input({ cards, config: short })))).toHaveLength(1); // (300 − 200) / 60
  });

  it('P1: con historial suficiente usa sus medianas', () => {
    const old = NOW - 30 * DAY;
    const history = [
      ...range(0, 20).map((i) => log(old + i * 60_000, Rating.Good, { durationMs: 30_000 })),
      // Cada nueva: dos pasos de 45 s → 90 s por tarjeta.
      ...range(0, 20).flatMap((i) => [
        log(old + i * HOUR, Rating.Good, { type: 'learn', durationMs: 45_000, cardId: id(500 + i) }),
        log(old + i * HOUR + 600_000, Rating.Good, {
          type: 'learn',
          durationMs: 45_000,
          cardId: id(500 + i),
        }),
      ]),
    ];
    const cards = [...range(1, 10).map((n) => reviewCard(n)), ...manyNew];
    const plan = buildSessionQueue(
      input({ cards, logs: history, config: cfgWith({ newPerSessionMax: 30 }) }),
    );
    expect(plan.timing).toMatchObject({
      reviewMs: 30_000,
      newMs: 90_000,
      reviewFromHistory: true,
      newFromHistory: true,
    });
    expect(news(plan)).toHaveLength(13); // (1500 − 300) / 90
  });

  it('AG4: el mínimo de muestras para usar sus medianas sale de la config', () => {
    const logs = range(0, 8).map((i) => log(NOW - 30 * DAY + i, Rating.Good, { durationMs: 30_000 }));
    const cards = [reviewCard(1)];
    expect(buildSessionQueue(input({ cards, logs })).timing.reviewMs).toBe(20_000);
    const lenient = cfgWith({ timingMinSamples: 8 });
    expect(buildSessionQueue(input({ cards, logs, config: lenient })).timing.reviewMs).toBe(30_000);
  });

  it('P1: el presupuesto crece con los bloques planeados', () => {
    const cards = [...range(1, 70).map((n) => reviewCard(n)), ...manyNew];
    expect(news(buildSessionQueue(input({ cards })))).toHaveLength(1); // (1500 − 1400) / 60
    expect(news(buildSessionQueue(input({ cards, plannedBlocks: 2 })))).toHaveLength(10);
    const twoByDefault = cfgWith({ sessionBlocksDefault: 2 });
    expect(news(buildSessionQueue(input({ cards, config: twoByDefault })))).toHaveLength(10);
  });

  it('§3: la retrievability baja con el tiempo y es 0 en las nuevas', () => {
    const scheduler = createScheduler(cfgWith().fsrs);
    const card = reviewCard(1, { stability: 8 }).state;
    const soon = scheduler.retrievability(card, NOW);
    expect(soon).toBeGreaterThan(0);
    expect(scheduler.retrievability(card, NOW + 3 * HOUR)).toBeLessThan(soon); // fracciones de día
    expect(scheduler.retrievability(newCard(2).state, NOW)).toBe(0);
  });
});

describe('P2: vencidas antes que nuevas', () => {
  // 5 min y 20 s por repaso → caben 15 repasos.
  const short = (planner = {}) => cfgWith(planner, { timer: { ...cfgWith().timer, focusMin: 5 } });
  const backlog = range(1, 35).map((n) => reviewCard(n, { due: NOW - 3 * DAY - n * HOUR }));

  it('las vencidas van primero en la cola', () => {
    const plan = buildSessionQueue(input({ cards: [...manyNew, reviewCard(1), reviewCard(2)] }));
    expect(plan.queue.slice(0, 2).map((q) => q.kind)).toEqual(['review', 'review']);
    expect(plan.queue.at(-1)?.kind).toBe('new');
  });

  it('P2: 0 nuevas si vencidas > factor × capacidad (usa la config)', () => {
    const cards = [...backlog, ...manyNew];
    const strict = buildSessionQueue(input({ cards, config: short({ overdueFactorForZeroNew: 2 }) }));
    expect(strict.capacity).toBe(15);
    expect(strict.newBlockedBy).toBe('overdue');
    expect(news(strict)).toHaveLength(0);
    const lenient = buildSessionQueue(input({ cards, config: short({ overdueFactorForZeroNew: 3 }) }));
    expect(lenient.newBlockedBy).toBeNull();
    expect(news(lenient).length).toBeGreaterThan(0);
  });
});

describe('P3: si falla mucho', () => {
  const cards = [reviewCard(1), ...manyNew];
  const lowDays = (days: readonly number[], count = 10, recalled = 7) =>
    days.flatMap((d) => dayOfReviews(TODAY_START - d * DAY, count, recalled));

  it('P3: 0 nuevas si la retención de 3 días queda 10 puntos bajo el objetivo', () => {
    const plan = buildSessionQueue(input({ cards, logs: lowDays([0, 1, 2], 10, 7) })); // 70 % < 80 %
    expect(plan.retention.current).toMatchObject({ reviews: 30, recalled: 21, low: true });
    expect(plan.newBlockedBy).toBe('low_retention');
    expect(news(plan)).toHaveLength(0);
    // 85 % no está 10 puntos bajo 90 %.
    expect(buildSessionQueue(input({ cards, logs: lowDays([0, 1], 10, 9) })).newBlockedBy).toBeNull();
  });

  it('AG4: la caída permitida y el objetivo salen de la config', () => {
    const logs = lowDays([0, 1, 2], 10, 7);
    expect(
      buildSessionQueue(input({ cards, logs, config: cfgWith({ lowRetentionDropPts: 25 }) })).newBlockedBy,
    ).toBe(null);
    const lowTarget = cfgWith({}, { fsrs: { ...cfgWith().fsrs, requestRetention: 0.8 } });
    expect(buildSessionQueue(input({ cards, logs, config: lowTarget })).newBlockedBy).toBeNull();
  });

  it('P3: la ventana es de días locales de ella (cambio de día en su zona)', () => {
    // 30 repasos malos a las 23:30 de hace 3 días en CDMX: fuera de la ventana de 3 días…
    const edge = TODAY_START - 2 * DAY - 30 * 60_000;
    const logs = range(0, 30).map((i) => log(edge + i * 1_000, Rating.Again));
    expect(buildSessionQueue(input({ cards, logs })).retention.current.reviews).toBe(0);
    // …pero en UTC ya son las 05:30 de hace 2 días: dentro.
    expect(buildSessionQueue(input({ cards, logs, timeZone: 'UTC' })).retention.current.reviews).toBe(30);
    // Con una ventana de 4 días entra también en CDMX.
    const wider = cfgWith({ lowRetentionWindowDays: 4 });
    expect(buildSessionQueue(input({ cards, logs, config: wider })).newBlockedBy).toBe('low_retention');
  });

  it('AG4: con pocos repasos no se juzga la retención', () => {
    const logs = lowDays([0], 10, 5); // 50 %, pero solo 10 repasos
    expect(buildSessionQueue(input({ cards, logs })).newBlockedBy).toBeNull();
    const fewer = cfgWith({ lowRetentionMinReviews: 10 });
    expect(buildSessionQueue(input({ cards, logs, config: fewer })).newBlockedBy).toBe('low_retention');
  });

  it('P3: con ≥ leechLapses lapsos la tarjeta va a reformular y no a la cola', () => {
    const leech = reviewCard(7, { lapses: 6 });
    const plan = buildSessionQueue(input({ cards: [leech, reviewCard(8)] }));
    expect(plan.reformulate).toEqual([id(7)]);
    expect(plan.queue.map((q) => q.cardId)).toEqual([id(8)]);
    const tolerant = buildSessionQueue(input({ cards: [leech], config: cfgWith({ leechLapses: 7 }) }));
    expect(tolerant.reformulate).toEqual([]);
    // Tras reformularla solo cuentan los lapsos nuevos.
    const reformulated = reviewCard(7, { lapses: 6, lapseBaseline: 3 });
    expect(buildSessionQueue(input({ cards: [reformulated] })).reformulate).toEqual([]);
  });

  it('P3: si persiste 7 días propone la mitad de nuevas, sin aplicarla', () => {
    const logs = lowDays(range(0, 9));
    const plan = buildSessionQueue(input({ cards, logs }));
    expect(plan.retention.lowStreakDays).toBe(7);
    expect(plan.proposedNewPerSessionMax).toBe(5);
    const thirds = buildSessionQueue(input({ cards, logs, config: cfgWith({ persistNewFactor: 0.3 }) }));
    expect(thirds.proposedNewPerSessionMax).toBe(3);
    const longer = buildSessionQueue(
      input({ cards, logs, config: cfgWith({ lowRetentionPersistDays: 10 }) }),
    );
    expect(longer.retention.lowStreakDays).toBe(8);
    expect(longer.proposedNewPerSessionMax).toBeNull();
    expect(buildSessionQueue(input({ cards, logs: lowDays([0, 1, 2]) })).proposedNewPerSessionMax).toBeNull();
  });
});

describe('P4: cuándo mezclar', () => {
  const runs = (items: readonly { topicId: string | null }[]) => {
    const lengths: number[] = [];
    items.forEach((item, i) => {
      if (i > 0 && items[i - 1]?.topicId === item.topicId)
        lengths[lengths.length - 1] = (lengths.at(-1) ?? 0) + 1;
      else lengths.push(1);
    });
    return lengths;
  };

  it('P4: ningún repaso seguido de más de 5 del mismo tema si hay otro', () => {
    // Las 12 de anatomía tienen menor retrievability: sin la regla irían todas juntas.
    const cards = [
      ...range(1, 12).map((n) => reviewCard(n, { topic: 'anatomia', stability: 1 + n / 100 })),
      ...range(20, 4).map((n) => reviewCard(n, { topic: 'fisiologia', stability: 30 })),
    ];
    const plan = buildSessionQueue(input({ cards }));
    expect(Math.max(...runs(reviews(plan)).slice(0, -1))).toBeLessThanOrEqual(5);
    const three = buildSessionQueue(input({ cards, config: cfgWith({ reviewMaxSameTopicRun: 3 }) }));
    expect(runs(reviews(three)).slice(0, 4)).toEqual([3, 1, 3, 1]);
  });

  it('P4: las rachas largas solo quedan cuando ya no hay otro tema (propiedad)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', 'c', null), { maxLength: 40 }),
        fc.integer({ min: 1, max: 6 }),
        (topics, maxRun) => {
          const out = limitTopicRuns(
            topics.map((topicId, i) => ({ topicId, i })),
            maxRun,
          );
          const violations = out.filter((item, i) => {
            const run = out.slice(Math.max(0, i - maxRun), i + 1);
            const tooLong = run.length > maxRun && run.every((r) => r.topicId === item.topicId);
            return tooLong && out.slice(i).some((r) => r.topicId !== item.topicId);
          });
          expect(violations).toEqual([]);
          expect(out.map((o) => o.i).sort((x, y) => x - y)).toEqual(topics.map((_, i) => i));
        },
      ),
    );
  });

  it('P4: las nuevas van por tema en tramos de hasta 10', () => {
    const cards = [
      ...range(1, 15).map((n) => newCard(n, 'nervios')),
      ...range(30, 15).map((n) => newCard(n, 'musculos')),
    ];
    const many = cfgWith({ newPerSessionMax: 30 }, { timer: { ...cfgWith().timer, focusMin: 60 } });
    expect(runs(news(buildSessionQueue(input({ cards, config: many }))))).toEqual([10, 10, 5, 5]);
    const fives = cfgWith({ newPerSessionMax: 30, newMaxSameTopicRun: 5 }, { timer: many.timer });
    expect(runs(news(buildSessionQueue(input({ cards, config: fives }))))).toEqual([5, 5, 5, 5, 5, 5]);
  });
});

describe('P8: regreso tras días sin estudiar', () => {
  const short = (planner = {}) =>
    cfgWith({ overdueFactorForZeroNew: 5, ...planner }, { timer: { ...cfgWith().timer, focusMin: 5 } });
  // 40 vencidas de días anteriores; la estabilidad decide la retrievability.
  const backlog = range(1, 40).map((n) => reviewCard(n, { due: NOW - 4 * DAY, stability: 1 + n }));

  it('P8: limita al presupuesto y reparte el atraso en 3 días, de menor a mayor retrievability', () => {
    const plan = buildSessionQueue(input({ cards: backlog, config: short() }));
    expect(plan).toMatchObject({ capacity: 15, due: 40, backlog: 40, backlogSpreadDays: 3 });
    expect(reviews(plan)).toHaveLength(14); // ⌈40 / 3⌉
    expect(reviews(plan).map((q) => q.cardId)).toEqual(range(1, 14).map((n) => id(n)));
  });

  it('AG4: los días de reparto salen de la config', () => {
    const five = buildSessionQueue(input({ cards: backlog, config: short({ backlogSpreadMinDays: 5 }) }));
    expect(five.backlogSpreadDays).toBe(5);
    expect(reviews(five)).toHaveLength(8);
    const huge = range(1, 200).map((n) => reviewCard(n, { due: NOW - 4 * DAY }));
    expect(buildSessionQueue(input({ cards: huge, config: short() })).backlogSpreadDays).toBe(7);
    const capped = buildSessionQueue(input({ cards: huge, config: short({ backlogSpreadMaxDays: 10 }) }));
    expect(capped.backlogSpreadDays).toBe(10);
    expect(reviews(capped)).toHaveLength(15); // nunca más que el presupuesto
  });

  it('P8: lo de hoy se respeta y el atraso usa el espacio que queda', () => {
    const today = range(100, 5).map((n) => reviewCard(n, { due: TODAY_START + HOUR }));
    const plan = buildSessionQueue(input({ cards: [...today, ...backlog.slice(0, 30)], config: short() }));
    expect(plan).toMatchObject({ due: 35, backlog: 30, backlogSpreadDays: 3 });
    expect(reviews(plan)).toHaveLength(15); // 5 de hoy + ⌈30 / 3⌉
  });

  it('si todo cabe no reparte nada', () => {
    const plan = buildSessionQueue(input({ cards: backlog.slice(0, 10), config: short() }));
    expect(plan.backlogSpreadDays).toBeNull();
    expect(reviews(plan)).toHaveLength(10);
  });

  it('si lo de hoy ya llena el presupuesto, el atraso espera', () => {
    const today = range(100, 20).map((n) => reviewCard(n, { due: TODAY_START + HOUR }));
    const plan = buildSessionQueue(input({ cards: [...today, ...backlog], config: short() }));
    expect(plan.backlogSpreadDays).toBeNull();
    expect(reviews(plan)).toHaveLength(15);
  });
});

describe('qué cuenta como vencida', () => {
  it('una aprendida vence si su fecha cae en el día local de hoy; en aprendizaje, solo si ya pasó', () => {
    const tonight = reviewCard(1, { due: TODAY_START + DAY - 1 });
    const tomorrow = reviewCard(2, { due: TODAY_START + DAY });
    const learningSoon: CardState = { ...reviewCard(3).state, phase: 'learning', due: NOW + 60_000 };
    const learningDue: CardState = { ...learningSoon, cardId: id(4), due: NOW };
    const cards = [
      tonight,
      tomorrow,
      { ...tonight, state: learningSoon },
      { ...tonight, state: learningDue },
    ];
    expect(
      reviews(buildSessionQueue(input({ cards })))
        .map((q) => q.cardId)
        .sort(),
    ).toEqual([id(1), id(4)]);
    // A las 23:00 en UTC "hoy" termina antes que en CDMX: la de esta noche ya no entra.
    expect(buildSessionQueue(input({ cards: [tomorrow], timeZone: 'UTC' })).due).toBe(0);
    expect(buildSessionQueue(input({ cards: [tonight], now: TODAY_START - HOUR })).due).toBe(0);
  });
});

describe('§5: carga de un grupo de tarjetas (un mazo)', () => {
  const cfg = cfgWith().planner;

  it('cuenta pendientes y nuevas con la misma regla que la cola', () => {
    const tonight = reviewCard(1, { due: TODAY_START + DAY - 1 });
    const tomorrow = reviewCard(2, { due: TODAY_START + DAY });
    const soon: CardState = { ...tonight.state, cardId: id(3), phase: 'learning', due: NOW + 60_000 };
    const learningSoon = { ...tonight, state: soon };
    const backlog = reviewCard(4, { due: NOW - 3 * DAY });
    const cards = [tonight, tomorrow, learningSoon, backlog, newCard(5), newCard(6)];
    expect(loadSummary(cards, NOW, TZ, cfg)).toEqual({ cards: 6, due: 2, fresh: 2 });
    expect(loadSummary(cards, NOW, TZ, cfg).due).toBe(buildSessionQueue(input({ cards })).due);
  });

  it('P3: las de "reformular" no cuentan como pendientes, con el borde de leechLapses', () => {
    const at = (lapses: number) => reviewCard(lapses, { lapses });
    const leech = PlannerConfigSchema.shape.leechLapses.unwrap();
    const [min, max] = [leech.minValue ?? 0, leech.maxValue ?? 0];
    expect(loadSummary([at(min - 1), at(min)], NOW, TZ, { leechLapses: min }).due).toBe(1);
    expect(loadSummary([at(max - 1), at(max)], NOW, TZ, { leechLapses: max }).due).toBe(1);
  });

  it('sin tarjetas, todo en cero', () => {
    expect(loadSummary([], NOW, TZ, cfg)).toEqual({ cards: 0, due: 0, fresh: 0 });
  });
});

describe('bordes de StudyConfig.planner (AGENTS §6)', () => {
  const shape = PlannerConfigSchema.shape;
  const keys = Object.keys(shape) as (keyof typeof shape)[];
  const bounds = keys.flatMap((key) => {
    const inner = shape[key].unwrap();
    return [inner.minValue, inner.maxValue].map((value) => [key, value ?? 0] as const);
  });
  const cards = [
    ...range(1, 30).map((n) => reviewCard(n, { topic: n % 2 ? 'a' : 'b', due: NOW - (n % 5) * DAY })),
    ...range(100, 30).map((n) => newCard(n, n % 3 ? 'a' : 'c')),
    reviewCard(200, { lapses: 20 }),
  ];
  const logs = range(0, 6).flatMap((d) => dayOfReviews(TODAY_START - d * DAY, 15, 9));

  it.each(bounds)('%s = %s da una cola válida', (key, value) => {
    const planner = StudyConfigSchema.parse({ planner: { [key]: value, ...spreadFix(key, value) } }).planner;
    const plan = buildSessionQueue(input({ cards, logs, config: cfgWith(planner) }));
    const ids = plan.queue.map((q) => q.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(news(plan).length).toBeLessThanOrEqual(planner.newPerSessionMax);
    expect(reviews(plan).length).toBeLessThanOrEqual(Math.max(plan.capacity, 0));
  });
});

/** min ≤ max de P8: al llevar uno al borde, el otro lo acompaña. */
function spreadFix(key: string, value: number) {
  if (key === 'backlogSpreadMinDays') return { backlogSpreadMaxDays: Math.max(value, 7) };
  if (key === 'backlogSpreadMaxDays') return { backlogSpreadMinDays: Math.min(value, 3) };
  return {};
}

describe('nextCard: la sesión en curso', () => {
  const start = NOW;
  const queue: QueueItem[] = [
    { cardId: id(1), topicId: 'a', kind: 'review' },
    { cardId: id(2), topicId: 'a', kind: 'new' },
  ];
  const fresh = new Map<string, CardState>([
    [id(1), reviewCard(1).state],
    [id(2), newCard(2).state],
  ]);

  it('sigue el orden de la cola y salta lo ya respondido', () => {
    expect(nextCard(queue, fresh, start, NOW)).toEqual({ kind: 'card', item: queue[0] });
    const afterFirst = new Map(fresh).set(id(1), {
      ...reviewCard(1).state,
      lastReview: NOW + 1_000,
      due: NOW + 9 * DAY,
    });
    expect(nextCard(queue, afterFirst, start, NOW + 1_000)).toEqual({ kind: 'card', item: queue[1] });
  });

  it('las tarjetas en aprendizaje vuelven cuando vencen y, si no, se espera', () => {
    const learning = new Map(fresh)
      .set(id(1), { ...reviewCard(1).state, lastReview: NOW + 1_000, due: NOW + 9 * DAY })
      .set(id(2), { ...newCard(2).state, phase: 'learning', lastReview: NOW + 2_000, due: NOW + 62_000 });
    expect(nextCard(queue, learning, start, NOW + 3_000)).toEqual({ kind: 'wait', until: NOW + 62_000 });
    expect(nextCard(queue, learning, start, NOW + 62_000)).toEqual({ kind: 'card', item: queue[1] });
    const graduated = new Map(learning).set(id(2), {
      ...newCard(2).state,
      phase: 'review',
      lastReview: NOW + 63_000,
      due: NOW + 3 * DAY,
    });
    expect(nextCard(queue, graduated, start, NOW + 64_000)).toEqual({ kind: 'done' });
  });

  it('una tarjeta borrada durante la sesión se salta', () => {
    const without = new Map(fresh);
    without.delete(id(1));
    expect(nextCard(queue, without, start, NOW)).toEqual({ kind: 'card', item: queue[1] });
  });

  it('una en aprendizaje vencida va antes que la siguiente pendiente', () => {
    const relearning = new Map(fresh).set(id(2), {
      ...reviewCard(2).state,
      phase: 'relearning',
      lastReview: NOW + 1_000,
      due: NOW + 2_000,
    });
    expect(nextCard(queue, relearning, start, NOW + 5_000)).toEqual({ kind: 'card', item: queue[1] });
  });
});

describe('timezone fixture', () => {
  it('la medianoche de las pruebas es la de CDMX', () => {
    expect(
      new Intl.DateTimeFormat('es', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(TODAY_START),
    ).toBe('0');
  });
});

describe('LD5: explicación y autoexplicación antes de lo nuevo', () => {
  const explained = new Set(['huesos']);

  it('R5: la primera tarjeta nueva de un tema sin autoexplicación la pide', () => {
    expect(needsTopicIntro({ kind: 'new', topicId: 'nervios' }, explained)).toBe(true);
  });

  it('R5: no la pide para repasos, notas sin tema ni temas ya explicados', () => {
    expect(needsTopicIntro({ kind: 'review', topicId: 'nervios' }, explained)).toBe(false);
    expect(needsTopicIntro({ kind: 'new', topicId: null }, explained)).toBe(false);
    expect(needsTopicIntro({ kind: 'new', topicId: 'huesos' }, explained)).toBe(false);
  });
});
