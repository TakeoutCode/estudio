import { newId, type PushResponse, PushResponseSchema } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deckRow,
  hlcAt,
  type IntegrationApp,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000a1';

describe('exámenes por sync (R11, BE2)', () => {
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
  const exams = async () => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: Record<string, unknown> }[] };
    return body.changes.filter((c) => c.entity === 'exam').map((c) => c.row);
  };
  const upsert = (entity: string, row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });
  const meta = () => ({ id: newId(), hlc: hlcAt(now, PHONE), updatedAt: now, deletedAt: null });
  const topic = (deckId: string) => ({ ...meta(), deckId, name: 'Plexo braquial', explanation: '' });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'examenes-a@ejemplo.mx');
    other = await signIn(server, 'examenes-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('BE2: cada tema del alcance tiene que ser suyo; el alcance vuelve igual por pull', async () => {
    const deck = deckRow(now, PHONE);
    const mine = [topic(deck.id), topic(deck.id)];
    await push(user, [upsert('deck', deck), ...mine.map((t) => upsert('topic', t))]);
    const foreignDeck = deckRow(now, PHONE);
    const foreign = topic(foreignDeck.id);
    await push(other, [upsert('deck', foreignDeck), upsert('topic', foreign)]);

    const exam = {
      ...meta(),
      title: 'Parcial 1',
      date: now + 10 * 86_400_000,
      topicIds: mine.map((t) => t.id),
    };
    const mixed = { ...meta(), title: 'Parcial 2', date: now, topicIds: [mine[0]?.id, foreign.id] };
    const results = (await push(user, [upsert('exam', mixed), upsert('exam', exam)])).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'not_found'],
      ['applied', undefined],
    ]);
    expect((await exams()).find((e) => e.id === exam.id)).toEqual(exam);
  });
});
