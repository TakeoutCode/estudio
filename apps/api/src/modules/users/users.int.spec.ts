import { cardIdFor, newId, type PushResponse, PushResponseSchema } from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import type { MediaPurger } from '../media/media-purger.js';
import { ident } from '../sync/sql.js';
import {
  cardRow,
  deckRow,
  hlcAt,
  type IntegrationApp,
  noteRow,
  PASSWORD,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000e1';

/** Tablas con filas de una cuenta; todas cuelgan de `user` con ON DELETE CASCADE. */
const TABLES = [
  'deck',
  'note',
  'card',
  'review_log',
  'media_asset',
  'reward',
  'reward_redemption',
  'refresh_token',
] as const;

describe('DELETE /me: borrado total de la cuenta (QUALITY QA6)', () => {
  let server: IntegrationApp;
  const purger = { purgeUser: vi.fn<MediaPurger['purgeUser']>() };
  let now: number;

  const push = async (token: string, mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
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

  /** Mazo, nota, Card, un repaso y un canje (tablas de solo inserción), una imagen y un premio. */
  const seed = async (token: string) => {
    const deck = deckRow(now, PHONE);
    const note = noteRow(now, PHONE, deck.id);
    const card = cardRow(now, PHONE, note.id);
    const review = {
      id: newId(),
      cardId: cardIdFor(note.id, 0),
      cardKind: 'basic',
      reviewedAt: now,
      rating: 3,
      durationMs: 4200,
      type: 'learn',
      confidence: null,
      sessionId: newId(),
      deviceId: PHONE,
    };
    const asset = {
      id: newId(),
      kind: 'image',
      mime: 'image/png',
      bytes: 1000,
      width: 10,
      height: 10,
      publicId: null,
      version: null,
      hlc: hlcAt(now, PHONE),
      updatedAt: now,
      deletedAt: null,
    };
    const reward = {
      id: newId(),
      name: 'Un postre',
      cost: 5,
      hlc: hlcAt(now, PHONE),
      updatedAt: now,
      deletedAt: null,
    };
    const redemption = {
      id: newId(),
      rewardId: reward.id,
      name: reward.name,
      cost: reward.cost,
      redeemedAt: now,
      deviceId: PHONE,
    };
    const results = await push(token, [
      upsert('deck', deck),
      upsert('note', note),
      upsert('card', card),
      { mutationId: newId(), op: 'append', entity: 'reviewLog', row: review },
      upsert('mediaAsset', asset),
      upsert('reward', reward),
      { mutationId: newId(), op: 'append', entity: 'rewardRedemption', row: redemption },
    ]);
    expect(results.results.map((r) => r.status)).toEqual(Array.from({ length: 7 }, () => 'applied'));
  };

  const rowsOf = async (userId: string) => {
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      const rows = await server.prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*) AS n FROM ${ident(table)} WHERE "user_id" = ${userId}::uuid`,
      );
      counts[table] = Number(rows[0]?.n ?? 0);
    }
    return counts;
  };

  beforeAll(async () => {
    server = await startIntegrationApp({ mediaPurger: purger });
    now = server.clock.now();
  });

  afterAll(async () => {
    await server.close();
  });

  const remove = (token: string, password: string) =>
    server.api().delete('/me').set('Authorization', `Bearer ${token}`).send({ password });

  it('con otra contraseña, o si Cloudinary falla, no borra nada', async () => {
    const user = await signIn(server, 'cuenta-a@ejemplo.mx');
    await seed(user.token);
    const before = await rowsOf(user.userId);

    const wrong = await remove(user.token, 'otra-contraseña-larga').expect(403);
    expect((wrong.body as { code: string }).code).toBe('forbidden');
    purger.purgeUser.mockRejectedValueOnce(new Error('cloudinary caído'));
    const down = await remove(user.token, PASSWORD).expect(503);
    expect((down.body as { code: string }).code).toBe('unavailable');
    expect(await rowsOf(user.userId)).toEqual(before);
    await server.api().delete('/me').send({ password: PASSWORD }).expect(401);
  });

  it('borra la cuenta, sus repasos (pese al trigger) y su carpeta; otra cuenta queda intacta', async () => {
    const user = await signIn(server, 'cuenta-a@ejemplo.mx');
    const other = await signIn(server, 'cuenta-b@ejemplo.mx');
    await seed(other.token);
    const otherBefore = await rowsOf(other.userId);
    purger.purgeUser.mockResolvedValueOnce('purged');

    const res = await remove(user.token, PASSWORD).expect(204);
    expect(purger.purgeUser).toHaveBeenLastCalledWith(user.userId);
    expect(String(res.headers['set-cookie'])).toMatch(/estudio_rt=;.*Path=\/auth/);
    const users = await server.prisma.$queryRaw<
      unknown[]
    >`SELECT 1 FROM "user" WHERE "id" = ${user.userId}::uuid`;
    expect(users).toHaveLength(0);
    expect(Object.values(await rowsOf(user.userId))).toEqual(TABLES.map(() => 0));
    expect(await rowsOf(other.userId)).toEqual(otherBefore);

    // El permiso de purga era solo de esa transacción: el trigger sigue protegiendo a la otra.
    await expect(
      server.prisma.$executeRaw`DELETE FROM "review_log" WHERE "user_id" = ${other.userId}::uuid`,
    ).rejects.toThrow(/append_only_table/);
    // La sesión ya no se renueva y la contraseña ya no entra.
    await server.api().post('/auth/refresh').set('Cookie', user.cookie).expect(401);
    await server
      .api()
      .post('/auth/login')
      .send({ email: 'cuenta-a@ejemplo.mx', password: PASSWORD })
      .expect(401);
  });
});
