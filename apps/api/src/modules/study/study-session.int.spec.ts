import { newId, type PushResponse, PushResponseSchema } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cardRow,
  deckRow,
  hlcAt,
  type IntegrationApp,
  noteRow,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000a1';

describe('simulacros por sync (P7, LD13, BE2)', () => {
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
  const sessions = async () => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: Record<string, unknown> }[] };
    return body.changes.filter((c) => c.entity === 'studySession').map((c) => c.row);
  };
  const upsert = (entity: string, row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });
  const meta = (wall = now) => ({ id: newId(), hlc: hlcAt(wall, PHONE), updatedAt: wall, deletedAt: null });

  /** Mazo, tema, nota con su tarjeta y examen de esa cuenta. */
  async function content(as: { token: string }) {
    const deck = deckRow(now, PHONE);
    const topic = { ...meta(), deckId: deck.id, name: 'Plexo braquial', explanation: '' };
    const note = noteRow(now, PHONE, deck.id, { topicId: topic.id });
    const card = cardRow(now, PHONE, note.id);
    const exam = { ...meta(), title: 'Parcial', date: now + 86_400_000, topicIds: [topic.id] };
    await push(as, [
      upsert('deck', deck),
      upsert('topic', topic),
      upsert('note', note),
      upsert('card', card),
      upsert('exam', exam),
    ]);
    return { card, exam, topic };
  }
  const item = (cardId: string, topicId: string) => ({
    cardId,
    topicId,
    confidence: 2,
    answer: 'El axilar',
    durationMs: 8_000,
    answeredAt: now,
    correct: null,
  });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'simulacros-a@ejemplo.mx');
    other = await signIn(server, 'simulacros-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('BE2: el examen y cada tarjeta tienen que ser suyos; las respuestas vuelven por pull', async () => {
    const mine = await content(user);
    const theirs = await content(other);
    const session = (examId: string, cardIds: string[]) => ({
      ...meta(),
      mode: 'exam',
      examId,
      feedbackTiming: 'end',
      items: cardIds.map((id) => item(id, mine.topic.id)),
      startedAt: now,
      finishedAt: null,
    });
    const ok = session(mine.exam.id, [mine.card.id]);
    const results = (
      await push(user, [
        upsert('studySession', session(theirs.exam.id, [mine.card.id])),
        upsert('studySession', session(mine.exam.id, [mine.card.id, theirs.card.id])),
        upsert('studySession', ok),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'not_found'],
      ['rejected', 'not_found'],
      ['applied', undefined],
    ]);
    expect((await sessions()).find((s) => s.id === ok.id)).toEqual(ok);

    // Calificar reescribe la fila (LWW) con un HLC mayor.
    const graded = {
      ...ok,
      items: [{ ...item(mine.card.id, mine.topic.id), correct: true }],
      finishedAt: now + 60_000,
      hlc: hlcAt(now + 60_000, PHONE),
      updatedAt: now + 60_000,
    };
    expect((await push(user, [upsert('studySession', graded)])).results[0]?.status).toBe('applied');
    expect((await sessions()).find((s) => s.id === ok.id)).toMatchObject({ finishedAt: now + 60_000 });
  });
});
