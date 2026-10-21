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

const PHONE = '0192f1a0-0000-7000-8000-0000000000f1';

describe('grupos de contraste por sync (R9, LD10, BE2)', () => {
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
  const upsert = (entity: string, row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });
  const group = (noteIds: readonly string[]) => ({
    id: newId(),
    name: 'Nervios craneales',
    noteIds,
    abSeed: 4_000_000_000, // más que un int de Postgres: va en BIGINT
    abArm: 'control',
    hlc: hlcAt(now, PHONE),
    updatedAt: now,
    deletedAt: null,
  });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'contraste-a@ejemplo.mx');
    other = await signIn(server, 'contraste-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('cada nota del grupo tiene que ser suya; el grupo vuelve igual por pull, con su brazo y semilla', async () => {
    const deck = deckRow(now, PHONE);
    const [a, b] = [noteRow(now, PHONE, deck.id), noteRow(now, PHONE, deck.id)];
    const foreignDeck = deckRow(now, PHONE);
    const foreign = noteRow(now, PHONE, foreignDeck.id);
    await push(other, [upsert('deck', foreignDeck), upsert('note', foreign)]);

    const mine = group([a.id, b.id]);
    const mixed = group([a.id, foreign.id]);
    const results = (
      await push(user, [
        upsert('deck', deck),
        upsert('note', a),
        upsert('note', b),
        upsert('contrastGroup', mixed),
        upsert('contrastGroup', mine),
        upsert('contrastGroup', { ...group([a.id]), id: newId() }),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['applied', undefined],
      ['applied', undefined],
      ['rejected', 'not_found'],
      ['applied', undefined],
      ['rejected', 'validation_failed'], // un solo miembro no es un grupo
    ]);

    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: unknown }[] };
    expect(body.changes.filter((c) => c.entity === 'contrastGroup').map((c) => c.row)).toEqual([mine]);
  });
});
