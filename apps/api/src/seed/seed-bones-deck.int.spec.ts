import {
  isSyncedEntity,
  newId,
  PullResponseSchema,
  PushResponseSchema,
  SYNC_ROW_SCHEMAS,
} from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deckRow, type IntegrationApp, signIn, startIntegrationApp } from '../test/integration-app.js';
import { BONES_DECK } from './bones-deck.js';
import { seedBonesDeck } from './seed-bones-deck.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000b1';

describe('seeder del mazo de huesos contra Postgres real', () => {
  let server: IntegrationApp;
  let user: { token: string; userId: string };

  const pull = async () => {
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    return PullResponseSchema.parse(res.body);
  };

  beforeAll(async () => {
    server = await startIntegrationApp();
    user = await signIn(server, 'semilla@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('crea el mazo una sola vez y llega completo por pull, con filas válidas (AG2)', async () => {
    const now = server.clock.now();
    const created = await seedBonesDeck(server.prisma, { userId: user.userId, now });
    if (created.status !== 'created') throw new Error('el primer seed debía crear el mazo');
    expect(await seedBonesDeck(server.prisma, { userId: user.userId, now })).toEqual({
      status: 'exists',
      deckId: created.deckId,
    });

    const page = await pull();
    expect(page.hasMore).toBe(false);
    const count = (entity: string) => page.changes.filter((c) => c.entity === entity).length;
    expect(count('deck')).toBe(1);
    expect(count('topic')).toBe(created.topics);
    expect(count('note')).toBe(created.notes);
    expect(count('card')).toBe(created.cards);
    for (const { entity, row } of page.changes) {
      if (isSyncedEntity(entity)) SYNC_ROW_SCHEMAS[entity].parse(row);
    }
    // SY3: el mazo llega antes que sus temas, notas y Cards.
    expect(page.changes.findIndex((c) => c.entity === 'deck')).toBeLessThan(
      page.changes.findIndex((c) => c.entity === 'topic'),
    );
  });

  it('si ella borró el mazo, crea uno nuevo en vez de revivirlo', async () => {
    const before = await pull();
    const deckId = String(before.changes.find((c) => c.entity === 'deck')?.row.id);
    server.clock.advance(60_000);
    const now = server.clock.now();
    const deleted = deckRow(now, PHONE, {
      id: deckId,
      name: BONES_DECK.name,
      description: BONES_DECK.description,
      deletedAt: now,
    });
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        deviceId: PHONE,
        mutations: [{ mutationId: newId(), op: 'upsert', entity: 'deck', row: deleted }],
      })
      .expect(200);
    expect(PushResponseSchema.parse(res.body).results.map((r) => r.status)).toEqual(['applied']);

    const again = await seedBonesDeck(server.prisma, { userId: user.userId, now });
    expect(again.status).toBe('created');
    expect(again.deckId).not.toBe(deckId);
  });
});
