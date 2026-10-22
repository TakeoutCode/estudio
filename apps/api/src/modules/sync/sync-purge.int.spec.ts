import {
  newId,
  type PullResponse,
  PullResponseSchema,
  type PushResponse,
  PushResponseSchema,
  type SyncedEntity,
} from '@estudio/shared';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  deckRow,
  hlcAt,
  type IntegrationApp,
  signIn,
  startIntegrationApp,
} from '../../test/integration-app.js';
import type { MediaPurger } from '../media/media-purger.js';
import { SyncPurgeService } from './sync-purge.service.js';

const NODE = '0192f1a0-0000-7000-8000-00000000000b';
const DAY = 86_400_000;

describe('SYNC §3 y §6: purga diaria del servidor', () => {
  let server: IntegrationApp;
  let purge: SyncPurgeService;
  let now: number;
  /** Los borrados de esta prueba son de hace 100 días: más viejos que cualquier otro de la base compartida. */
  let old: number;
  const deleteAssets = vi.fn<MediaPurger['deleteAssets']>((_userId, ids) => Promise.resolve([...ids]));

  const push = async (token: string, mutations: unknown[]): Promise<PushResponse> => {
    const res = await server
      .api()
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceId: NODE, mutations })
      .expect(200);
    return PushResponseSchema.parse(res.body);
  };
  const pull = async (token: string, cursor = '0'): Promise<PullResponse> => {
    const res = await server
      .api()
      .get(`/sync/pull?cursor=${cursor}&limit=500`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return PullResponseSchema.parse(res.body);
  };
  const upsert = (row: Record<string, unknown>, entity = 'deck') => ({
    mutationId: newId(),
    op: 'upsert',
    entity,
    row,
  });
  /** El mismo registro, borrado en `at` (con su HLC). */
  const deletedAt = (row: Record<string, unknown>, at: number) => ({
    ...row,
    hlc: hlcAt(at, NODE),
    updatedAt: at,
    deletedAt: at,
  });
  const asset = (wall: number) => ({
    id: newId(),
    kind: 'image',
    mime: 'image/jpeg',
    bytes: 1000,
    width: 100,
    height: 100,
    publicId: null,
    version: null,
    hlc: hlcAt(wall, NODE),
    updatedAt: wall,
    deletedAt: null,
  });
  const exists = async (table: 'deck' | 'media_asset', id: string) => {
    const rows =
      table === 'deck'
        ? await server.prisma.$queryRaw<unknown[]>`SELECT 1 FROM "deck" WHERE "id" = ${id}::uuid`
        : await server.prisma.$queryRaw<unknown[]>`SELECT 1 FROM "media_asset" WHERE "id" = ${id}::uuid`;
    return rows.length > 0;
  };
  const purgedThrough = async (userId: string) => {
    const [row] = await server.prisma.$queryRaw<{ seq: bigint }[]>`
      SELECT "purged_through_seq" AS "seq" FROM "user" WHERE "id" = ${userId}::uuid`;
    return row?.seq ?? 0n;
  };

  beforeAll(async () => {
    server = await startIntegrationApp({
      mediaPurger: { purgeUser: () => Promise.resolve('unconfigured'), deleteAssets },
    });
    purge = server.app.get(SyncPurgeService);
    now = server.clock.now();
    old = now - 100 * DAY;
  });

  afterAll(async () => {
    await server.close();
  });

  it('SYNC §6: purga borrados de más de 90 días, sube purgedThroughSeq y un cursor viejo recibe 410', async () => {
    const a = await signIn(server, 'purga-a@ejemplo.mx');
    const alive = deckRow(old, NODE, { name: 'Sigue' });
    const gone = deckRow(old - 1, NODE, { name: 'Se fue' });
    const recent = deckRow(old - 1, NODE, { name: 'Borrado hace poco' });
    await push(a.token, [upsert(alive), upsert(gone), upsert(recent)]);
    const before = (await pull(a.token)).cursor; // un dispositivo que todavía no vio los borrados
    await push(a.token, [upsert(deletedAt(gone, old)), upsert(deletedAt(recent, now - 10 * DAY))]);

    const summary = await purge.run(now);
    expect(summary).toMatchObject({ deferred: 0 });
    expect(summary?.tombstones).toBeGreaterThanOrEqual(1);
    expect(await exists('deck', gone.id)).toBe(false);
    expect(await exists('deck', recent.id)).toBe(true); // 10 días: todavía se puede revivir
    expect(await exists('deck', alive.id)).toBe(true);
    expect(await purgedThrough(a.userId)).toBeGreaterThan(BigInt(before));

    const res = await server
      .api()
      .get(`/sync/pull?cursor=${before}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(410);
    expect(res.body).toMatchObject({ code: 'cursor_expired' });
    // El pull completo ya no lo trae; un cursor posterior al borrado sigue sirviendo.
    const full = await pull(a.token);
    expect(full.changes.map((c) => c.row.id)).not.toContain(gone.id);
    await pull(a.token, full.cursor);
  });

  it('SYNC §6: la imagen se borra en Cloudinary antes de purgar su asset; si falla, el asset espera', async () => {
    const b = await signIn(server, 'purga-b@ejemplo.mx');
    const [kept, dropped] = [asset(old - 1), asset(old - 1)];
    await push(b.token, [upsert(kept, 'mediaAsset'), upsert(dropped, 'mediaAsset')]);
    await push(b.token, [
      upsert(deletedAt(kept, old), 'mediaAsset'),
      upsert(deletedAt(dropped, old), 'mediaAsset'),
    ]);
    // Cloudinary confirma solo uno; el otro queda para la próxima vuelta.
    deleteAssets.mockImplementationOnce((_userId, ids) =>
      Promise.resolve(ids.filter((id) => id === dropped.id)),
    );
    const summary = await purge.run(now);
    expect(deleteAssets).toHaveBeenCalledWith(b.userId, expect.arrayContaining([kept.id, dropped.id]));
    expect(summary?.deferred).toBeGreaterThanOrEqual(1);
    expect(await exists('media_asset', dropped.id)).toBe(false);
    expect(await exists('media_asset', kept.id)).toBe(true);

    // Si Cloudinary no responde, no se purga nada de esa cuenta.
    deleteAssets.mockRejectedValueOnce(new Error('cloudinary_delete_failed_503'));
    await purge.run(now);
    expect(await exists('media_asset', kept.id)).toBe(true);
    await purge.run(now);
    expect(await exists('media_asset', kept.id)).toBe(false);
  });

  it('un borrado revivido entre la selección y el borrado se queda', async () => {
    const c = await signIn(server, 'purga-c@ejemplo.mx');
    const deck = deckRow(old - 1, NODE, { name: 'Revive' });
    await push(c.token, [upsert(deck)]);
    await push(c.token, [upsert(deletedAt(deck, old))]);
    // Fuera de un request no hay contexto de CLS: el cron lo abre con @UseCls en `run`.
    const cls = server.app.get(ClsService);
    const claim = await cls.run(() => purge.claim(now));
    const ids = claim?.candidates.get(c.userId)?.get('deck') ?? [];
    expect(ids).toContain(deck.id);
    // Otro dispositivo lo edita después de borrarlo (SYNC §5: lo revive).
    await push(c.token, [upsert({ ...deck, name: 'Revivido', hlc: hlcAt(now, NODE), updatedAt: now })]);
    const allowed = new Map<SyncedEntity, readonly string[]>([['deck', ids]]);
    expect(await cls.run(() => purge.purgeUser(c.userId, allowed, claim?.cutoff ?? 0))).toBe(0);
    expect(await exists('deck', deck.id)).toBe(true);
  });

  it('SYNC §3: applied_mutation de más de 30 días se purga y el push sigue sin duplicar', async () => {
    const d = await signIn(server, 'purga-d@ejemplo.mx');
    const mutation = upsert(deckRow(now, NODE));
    expect((await push(d.token, [mutation])).results[0]?.status).toBe('applied');
    // `applied_at` es la hora real de Postgres: se lleva al pasado para no depender del reloj.
    await server.prisma.$executeRaw`
      UPDATE "applied_mutation" SET "applied_at" = ${new Date(now - 31 * DAY)}
      WHERE "user_id" = ${d.userId}::uuid`;
    expect((await purge.run(now))?.appliedMutations).toBeGreaterThanOrEqual(1);
    const [left] = await server.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS "n" FROM "applied_mutation" WHERE "user_id" = ${d.userId}::uuid`;
    expect(left?.n).toBe(0n);
    // Reenviar la misma mutación: HLC igual no gana (stale) y no duplica la fila.
    expect((await push(d.token, [mutation])).results[0]?.status).toBe('stale');
    const decks = await server.prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM "deck" WHERE "user_id" = ${d.userId}::uuid`;
    expect(decks).toHaveLength(1);
  });

  it('ARC7: si otra instancia tiene el lock, no hace nada', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const other = server.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('sync:purge', 0))`;
        signalLocked();
        await held;
      },
      { timeout: 20_000 },
    );
    await locked;
    expect(await purge.run(now)).toBeNull();
    release();
    await other;
  });
});
