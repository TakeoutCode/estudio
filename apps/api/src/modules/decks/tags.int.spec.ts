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

const PHONE = '0192f1a0-0000-7000-8000-0000000000c1';

describe('etiquetas por sync (diseño, BE2)', () => {
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
  const tag = (name: string) => ({
    id: newId(),
    name,
    hlc: hlcAt(now, PHONE),
    updatedAt: now,
    deletedAt: null,
  });
  const pulled = async (as: { token: string }, entity: string) => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${as.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: unknown }[] };
    return body.changes.filter((c) => c.entity === entity).map((c) => c.row);
  };

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'etiquetas-a@ejemplo.mx');
    other = await signIn(server, 'etiquetas-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('cada etiqueta de una nota tiene que ser suya; la nota vuelve igual por pull con sus etiquetas', async () => {
    const foreign = tag('De otra cuenta');
    await push(other, [upsert('tag', foreign)]);

    const deck = deckRow(now, PHONE);
    const [arm, exam] = [tag('Miembro superior'), tag('Parcial 2')];
    const tagged = noteRow(now, PHONE, deck.id, { tagIds: [arm.id, exam.id] });
    const stolen = noteRow(now, PHONE, deck.id, { tagIds: [arm.id, foreign.id] });
    const results = (
      await push(user, [
        upsert('deck', deck),
        upsert('tag', arm),
        upsert('tag', exam),
        upsert('note', tagged),
        upsert('note', stolen),
        upsert('note', noteRow(now, PHONE, deck.id, { tagIds: [arm.id, arm.id] })),
      ])
    ).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['applied', undefined],
      ['applied', undefined],
      ['applied', undefined],
      ['rejected', 'not_found'],
      ['rejected', 'validation_failed'], // la misma etiqueta dos veces
    ]);
    expect(await pulled(user, 'note')).toEqual([tagged]);
    expect(await pulled(user, 'tag')).toEqual([arm, exam]);
  });

  it('una nota del contrato 12 (sin tagIds) entra sin etiquetas', async () => {
    const deck = deckRow(now, PHONE);
    const legacy: Record<string, unknown> = noteRow(now, PHONE, deck.id);
    delete legacy.tagIds;
    const results = (await push(user, [upsert('deck', deck), upsert('note', legacy)])).results;
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(await pulled(user, 'note')).toContainEqual({ ...legacy, tagIds: [] });
  });
});
