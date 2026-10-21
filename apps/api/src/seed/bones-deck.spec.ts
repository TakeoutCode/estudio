import { cardIdFor, cardOrdinals, decodeHlc, SERVER_NODE } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { BONES_DECK, buildBonesDeck, type TopicEntry } from './bones-deck.js';

const NOW = Date.UTC(2026, 9, 20, 12);

const sum = (topics: readonly TopicEntry[]) =>
  topics.flatMap((t) => t.bones).reduce((total, b) => total + b.count, 0);

describe('mazo de huesos del seeder', () => {
  it('cubre los 206 huesos del adulto: 80 axiales y 126 apendiculares', () => {
    const { topics } = BONES_DECK;
    expect(sum(topics)).toBe(206);
    expect(sum(topics.filter((t) => t.skeleton === 'axial'))).toBe(80);
    expect(sum(topics.filter((t) => t.skeleton === 'appendicular'))).toBe(126);
  });

  it('cada región suma lo que dicen sus tarjetas de conteo', () => {
    const byTopic = Object.fromEntries(BONES_DECK.topics.map((t) => [t.name, sum([t])]));
    expect(byTopic).toEqual({
      'Visión general': 0,
      Neurocráneo: 8,
      'Viscerocráneo (cara)': 14,
      'Huesecillos del oído e hioides': 7, // 6 huesecillos y el hioides
      'Columna vertebral': 26,
      Tórax: 25,
      'Cintura escapular, brazo y antebrazo': 10, // 32 por miembro, 27 en la mano
      Mano: 54, // 27 por mano
      'Cintura pélvica, muslo y pierna': 10, // 31 por miembro, 26 en el pie
      Pie: 52, // 26 por pie
    });
  });

  it('AG2: las filas pasan sus esquemas y se enlazan entre sí', () => {
    const { deck, topics, notes, cards } = buildBonesDeck(NOW);
    const topicIds = new Set(topics.map((t) => t.id));
    expect(topics).toHaveLength(BONES_DECK.topics.length);
    expect(topics.every((t) => t.deckId === deck.id)).toBe(true);
    expect(notes.every((n) => n.deckId === deck.id && n.topicId !== null && topicIds.has(n.topicId))).toBe(
      true,
    );
    expect(notes.every((n) => n.origin === 'manual')).toBe(true);

    const ids = [deck, ...topics, ...notes, ...cards].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('SYNC §1: una Card por lado o hueco, con su id determinista', () => {
    const { notes, cards } = buildBonesDeck(NOW);
    const expected = notes.flatMap((n) => cardOrdinals(n.content).map((o) => cardIdFor(n.id, o)));
    expect(cards.map((c) => c.id)).toEqual(expected);
    expect(cards.every((c) => c.lapseBaseline === 0)).toBe(true);
  });

  it('las nuevas salen en el orden del mazo y ninguna nace en el futuro', () => {
    const { cards } = buildBonesDeck(NOW);
    const created = cards.map((c) => c.createdAt);
    expect(created).toEqual([...created].sort((a, b) => a - b));
    expect(new Set(created).size).toBe(created.length);
    expect(Math.max(...created)).toBeLessThan(NOW);
  });

  it('SYNC §2: escritura del servidor con HLC de nodo nil', () => {
    const { deck, notes } = buildBonesDeck(NOW);
    expect(decodeHlc(deck.hlc)).toEqual({ wall: NOW, counter: 0, node: SERVER_NODE });
    expect(notes.every((n) => n.updatedAt === NOW && n.deletedAt === null)).toBe(true);
  });
});
