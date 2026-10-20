import { newId, type PushResponse, PushResponseSchema } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deckRow,
  hlcAt,
  type IntegrationApp,
  noteRow,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000a1';

describe('temas y autoexplicaciones por sync (LD5, BE2)', () => {
  let server: IntegrationApp;
  let user: { token: string };
  let other: { token: string };
  let now: number;

  const push = async (as: { token: string }, mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${as.token}`)
      .send({ deviceId: PHONE, mutations })
      .expect(200);
    return PushResponseSchema.parse(res.body);
  };
  const rows = async (entity: string) => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: Record<string, unknown> }[] };
    return body.changes.filter((c) => c.entity === entity).map((c) => c.row);
  };
  const upsert = (entity: string, row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });
  const topicRow = (deckId: string, overrides: Record<string, unknown> = {}) => ({
    id: newId(),
    deckId,
    name: 'Plexo braquial',
    explanation: 'Raíces C5-T1 que forman troncos, divisiones, fascículos y ramos.',
    hlc: hlcAt(now, PHONE),
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  });
  const selfRow = (topicId: string) => ({
    id: newId(),
    topicId,
    text: 'Son las raíces que bajan al brazo y se reparten en nervios.',
    writtenAt: now,
    hlc: hlcAt(now, PHONE),
    updatedAt: now,
    deletedAt: null,
  });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'temas-a@ejemplo.mx');
    other = await signIn(server, 'temas-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('BE2: el tema pide un mazo suyo; llega y vuelve igual por pull', async () => {
    const deck = deckRow(now, PHONE);
    const topic = topicRow(deck.id);
    const results = (
      await push(user, [upsert('deck', deck), upsert('topic', topicRow(newId())), upsert('topic', topic)])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['rejected', 'not_found'],
      ['applied', undefined],
    ]);
    expect((await rows('topic')).find((t) => t.id === topic.id)).toEqual(topic);
  });

  it('BE2: una nota solo puede apuntar a un tema suyo', async () => {
    const deck = deckRow(now, PHONE);
    const topic = topicRow(deck.id);
    await push(user, [upsert('deck', deck), upsert('topic', topic)]);
    const foreignDeck = deckRow(now, PHONE);
    const foreignTopic = topicRow(foreignDeck.id);
    await push(other, [upsert('deck', foreignDeck), upsert('topic', foreignTopic)]);

    const results = (
      await push(user, [
        upsert('note', noteRow(now, PHONE, deck.id, { topicId: foreignTopic.id })),
        upsert('note', noteRow(now, PHONE, deck.id, { topicId: topic.id })),
      ])
    ).results;
    expect(results.map((r) => r.status)).toEqual(['rejected', 'applied']);
  });

  it('LD5: la autoexplicación pide un tema suyo y viaja como LWW', async () => {
    const deck = deckRow(now, PHONE);
    const topic = topicRow(deck.id);
    await push(user, [upsert('deck', deck), upsert('topic', topic)]);
    const mine = selfRow(topic.id);
    const results = (
      await push(user, [upsert('selfExplanation', selfRow(newId())), upsert('selfExplanation', mine)])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'not_found'],
      ['applied', undefined],
    ]);
    expect((await rows('selfExplanation')).find((s) => s.id === mine.id)).toEqual(mine);

    // Editarla con un HLC mayor gana; con el mismo, es `stale` (SYNC §5).
    const edited = {
      ...mine,
      text: 'Otra forma de decirlo.',
      hlc: hlcAt(now + 1_000, PHONE),
      updatedAt: now + 1_000,
    };
    expect((await push(user, [upsert('selfExplanation', edited)])).results[0]?.status).toBe('applied');
    expect((await push(user, [upsert('selfExplanation', mine)])).results[0]?.status).toBe('stale');
    expect((await rows('selfExplanation')).find((s) => s.id === mine.id)).toMatchObject({
      text: 'Otra forma de decirlo.',
    });
  });
});
