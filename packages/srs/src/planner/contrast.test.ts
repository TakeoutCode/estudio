import { type ContrastArm, defaultStudyConfig, Rating } from '@estudio/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cfgWith, DAY, id, input, log, newCard, NOW, range, reviewCard } from '../test/planner-fixtures.js';
import {
  applyContrastSets,
  contrastComparison,
  type ContrastPlanGroup,
  contrastReadyAt,
  drawContrastArm,
  firstCorrectByCard,
} from './contrast.js';
import { buildSessionQueue, type QueueItem } from './queue.js';

const GROUP = '0192f1a0-0000-7000-8222-000000000001';
const OTHER = '0192f1a0-0000-7000-8222-000000000002';
const contrastCfg = defaultStudyConfig().contrast;

/** Un miembro por nota, con una Card cada uno. */
const group = (
  cards: readonly number[],
  arm: ContrastArm = 'contrast',
  groupId = GROUP,
): ContrastPlanGroup => ({
  id: groupId,
  arm,
  members: cards.map((n) => [id(n)]),
});
/** El primer acierto de cada Card, hace 20 días. */
const learned = (cards: readonly number[]) =>
  cards.map((n) => log(NOW - 20 * DAY, Rating.Good, { type: 'learn', cardId: id(n) }));
const reviewItem = (n: number, topic = 'anatomia'): QueueItem => ({
  cardId: id(n),
  topicId: topic,
  kind: 'review',
});

describe('LD10: brazo de cada grupo (A/B)', () => {
  it('va al brazo con menos grupos; si están parejos, decide la semilla', () => {
    expect(drawContrastArm(7, { contrast: 2, control: 1 })).toBe('control');
    expect(drawContrastArm(7, { contrast: 0, control: 3 })).toBe('contrast');
    expect(drawContrastArm(4, { contrast: 1, control: 1 })).toBe('contrast');
    expect(drawContrastArm(5, { contrast: 1, control: 1 })).toBe('control');
  });

  it('con cualquier serie de semillas, los brazos nunca se separan por más de un grupo', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 0xffff_ffff }), { maxLength: 60 }), (seeds) => {
        const counts = { contrast: 0, control: 0 };
        for (const seed of seeds) counts[drawContrastArm(seed, counts)] += 1;
        expect(Math.abs(counts.contrast - counts.control)).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('R9, P4: el grupo queda listo tras el primer acierto de cada miembro', () => {
  it('Again no cuenta; listo a la hora del último primer acierto', () => {
    const logs = [
      log(NOW - 5 * DAY, Rating.Again, { type: 'learn', cardId: id(1) }),
      log(NOW - 4 * DAY, Rating.Hard, { type: 'learn', cardId: id(1) }),
      log(NOW - 3 * DAY, Rating.Again, { type: 'learn', cardId: id(2) }),
    ];
    const g = group([1, 2]);
    expect(contrastReadyAt(g, firstCorrectByCard(logs))).toBeNull();
    const more = [...logs, log(NOW - 2 * DAY, Rating.Good, { type: 'learn', cardId: id(2) })];
    expect(contrastReadyAt(g, firstCorrectByCard(more))).toBe(NOW - 2 * DAY);
  });

  it('una nota con inversa está lista con el acierto de cualquiera de sus lados', () => {
    const g: ContrastPlanGroup = { id: GROUP, arm: 'contrast', members: [[id(1), id(11)], [id(2)]] };
    const logs = [...learned([11]), ...learned([2])];
    expect(contrastReadyAt(g, firstCorrectByCard(logs))).toBe(NOW - 20 * DAY);
  });

  it('con menos de 2 miembros vivos no hay set', () => {
    const g: ContrastPlanGroup = { id: GROUP, arm: 'contrast', members: [[id(1)], []] };
    expect(contrastReadyAt(g, firstCorrectByCard(learned([1])))).toBeNull();
  });
});

describe('P4, LD10: sets de contraste en la cola', () => {
  const items = [reviewItem(1), reviewItem(9, 'otro'), reviewItem(2), reviewItem(8, 'otro'), reviewItem(3)];

  it('los repasos del grupo van seguidos en el lugar del más urgente, marcados con su grupo', () => {
    const out = applyContrastSets(items, [group([1, 2, 3])], new Set([GROUP]), 5);
    expect(out.map((i) => [i.cardId, i.contrastGroupId])).toEqual([
      [id(1), GROUP],
      [id(2), GROUP],
      [id(3), GROUP],
      [id(9), undefined],
      [id(8), undefined],
    ]);
  });

  it('el control, un grupo sin listar como listo o con un solo miembro vencido no cambian la cola', () => {
    expect(applyContrastSets(items, [group([1, 2, 3], 'control')], new Set([GROUP]), 5)).toEqual(items);
    expect(applyContrastSets(items, [group([1, 2, 3])], new Set(), 5)).toEqual(items);
    expect(applyContrastSets(items, [group([1, 77])], new Set([GROUP]), 5)).toEqual(items);
  });

  it('maxSetSize: con 2 solo entran las dos más urgentes; con 12 entran todas las vencidas', () => {
    const many = range(1, 14).map((n) => reviewItem(n));
    const g = group(range(1, 14));
    const two = applyContrastSets(many, [g], new Set([GROUP]), 2);
    expect(two.filter((i) => i.contrastGroupId).map((i) => i.cardId)).toEqual([id(1), id(2)]);
    const twelve = applyContrastSets(many, [g], new Set([GROUP]), 12);
    expect(twelve.slice(0, 12).every((i) => i.contrastGroupId === GROUP)).toBe(true);
    expect(twelve[12]?.contrastGroupId).toBeUndefined();
  });

  it('una tarjeta entra en un solo set y las nuevas nunca', () => {
    const withNew = [...items, { cardId: id(4), topicId: 'anatomia', kind: 'new' as const }];
    const out = applyContrastSets(
      withNew,
      [group([1, 2, 4]), group([1, 3], 'contrast', OTHER)],
      new Set([GROUP, OTHER]),
      5,
    );
    expect(out.filter((i) => i.contrastGroupId === GROUP).map((i) => i.cardId)).toEqual([id(1), id(2)]);
    expect(out.filter((i) => i.contrastGroupId === OTHER)).toEqual([]); // le quedó un solo miembro
    expect(out.find((i) => i.cardId === id(4))?.contrastGroupId).toBeUndefined();
  });

  it('en buildSessionQueue: solo después del primer acierto de cada miembro', () => {
    const cards = [reviewCard(1), reviewCard(9, { topic: 'otro' }), reviewCard(2), newCard(500)];
    const plain = buildSessionQueue(input({ cards, contrastGroups: [group([1, 2])] }));
    expect(plain.queue.some((i) => i.contrastGroupId)).toBe(false);
    const ready = buildSessionQueue(input({ cards, logs: learned([1, 2]), contrastGroups: [group([1, 2])] }));
    const set = ready.queue.filter((i) => i.contrastGroupId === GROUP).map((i) => i.cardId);
    expect(set.sort()).toEqual([id(1), id(2)]);
    const at = ready.queue.findIndex((i) => i.contrastGroupId === GROUP);
    expect(ready.queue[at + 1]?.contrastGroupId).toBe(GROUP); // seguidas
  });
});

describe('LD10: retención a 7 días o más por brazo', () => {
  const READY = NOW - 60 * DAY;
  /** Aprendida en READY y luego repasos cada `gapDays` días con estas calificaciones. */
  const history = (
    n: number,
    gapDays: number,
    ratings: readonly Rating[],
    type: 'review' | 'contrast' = 'review',
  ) => [
    log(READY, Rating.Good, { type: 'learn', cardId: id(n) }),
    ...ratings.map((rating, i) => log(READY + (i + 1) * gapDays * DAY, rating, { type, cardId: id(n) })),
  ];

  it('cuenta repasos con al menos retentionMinDays desde el anterior, Good y Easy como recordados', () => {
    const logs = [
      ...history(1, 7, [Rating.Good, Rating.Again, Rating.Easy], 'contrast'),
      ...history(2, 7, [Rating.Hard]),
      ...history(3, 3, [Rating.Good, Rating.Good]), // 3 días: no llegan a 7
      ...history(4, 10, [Rating.Good]),
    ];
    const groups = [group([1, 2], 'contrast'), group([3, 4], 'control', OTHER)];
    const result = contrastComparison(groups, logs, contrastCfg);
    expect(result.contrast).toMatchObject({ total: 4, successes: 2 }); // Hard no es "recordada" (§5)
    expect(result.control).toMatchObject({ total: 1, successes: 1 });
    expect(result.enough).toBe(false);
  });

  it('retentionMinDays de 1 a 60 cambia qué intervalos cuentan', () => {
    const logs = [...history(1, 3, [Rating.Good]), ...history(2, 60, [Rating.Good])];
    const groups = [group([1, 2])];
    expect(contrastComparison(groups, logs, { ...contrastCfg, retentionMinDays: 1 }).contrast.total).toBe(2);
    expect(contrastComparison(groups, logs, { ...contrastCfg, retentionMinDays: 60 }).contrast.total).toBe(1);
  });

  it('no cuenta lo anterior a que el grupo quedara listo, los simulacros ni las tarjetas de los dos brazos', () => {
    const late = NOW - 10 * DAY;
    const logs = [
      log(READY, Rating.Good, { type: 'learn', cardId: id(1) }),
      log(READY + 8 * DAY, Rating.Good, { cardId: id(1) }), // antes de que el 2 aprendiera
      log(late, Rating.Good, { type: 'learn', cardId: id(2) }),
      log(late + 8 * DAY, Rating.Good, { type: 'exam', cardId: id(2) }),
      ...history(5, 8, [Rating.Good]),
      ...history(6, 8, [Rating.Good]),
    ];
    const groups = [
      group([1, 2]),
      group([5, 6], 'contrast', OTHER),
      group([6, 1], 'control', '0192f1a0-0000-7000-8222-000000000003'),
    ];
    const result = contrastComparison(groups, logs, contrastCfg);
    expect(result.contrast.total).toBe(1); // solo la 5: la 1 y la 6 están en los dos brazos
    expect(result.control.total).toBe(0);
  });

  it('minReviewsPerArm: con 5 y 5 repasos por brazo ya compara; con 500 no', () => {
    const logs = [
      ...range(1, 5).flatMap((n) => history(n, 8, [Rating.Good])),
      ...range(11, 5).flatMap((n) => history(n, 8, [Rating.Again])),
    ];
    const groups = [group(range(1, 5)), group(range(11, 5), 'control', OTHER)];
    expect(contrastComparison(groups, logs, { ...contrastCfg, minReviewsPerArm: 5 })).toMatchObject({
      enough: true,
      contrast: { rate: 1 },
      control: { rate: 0 },
    });
    expect(contrastComparison(groups, logs, { ...contrastCfg, minReviewsPerArm: 500 }).enough).toBe(false);
  });

  it('cfgWith conserva la sección contrast', () => {
    expect(cfgWith().contrast).toEqual(contrastCfg);
  });
});
