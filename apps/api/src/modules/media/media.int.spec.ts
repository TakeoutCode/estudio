import {
  MediaAssetSchema,
  mediaPublicId,
  MediaSignatureSchema,
  newId,
  type PushResponse,
  PushResponseSchema,
} from '@estudio/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hlcAt, type IntegrationApp, signIn, startIntegrationApp } from '../../test/integration-app.js';
import { signParams } from './media-signer.js';

const PHONE = '0192f1a0-0000-7000-8000-0000000000c1';

describe('media: MediaAsset por sync y firma de subida (FE8, ARC8)', () => {
  let server: IntegrationApp;
  let user: { token: string; userId: string };
  let other: { token: string; userId: string };
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
  const upsert = (row: Record<string, unknown>) => ({
    mutationId: newId(),
    op: 'upsert',
    entity: 'mediaAsset',
    row,
  });
  const asset = (overrides: Record<string, unknown> = {}) => ({
    id: newId(),
    kind: 'image',
    mime: 'image/jpeg',
    bytes: 420_000,
    width: 1600,
    height: 1200,
    publicId: null,
    version: null,
    hlc: hlcAt(now, PHONE),
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  });
  const sign = (as: { token: string }, assetId: string) =>
    server.api().post('/media/signature').set('Authorization', `Bearer ${as.token}`).send({ assetId });

  beforeAll(async () => {
    server = await startIntegrationApp();
    now = server.clock.now();
    user = await signIn(server, 'media-a@ejemplo.mx');
    other = await signIn(server, 'media-b@ejemplo.mx');
  });

  afterAll(async () => {
    await server.close();
  });

  it('el asset sin subir viaja por push y vuelve igual por pull', async () => {
    const row = asset();
    expect((await push(user, [upsert(row)])).results.map((r) => r.status)).toEqual(['applied']);
    const res = await server
      .api()
      .get('/sync/pull?cursor=0&limit=500')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const body = res.body as { changes: { entity: string; row: unknown }[] };
    const pulled = body.changes
      .filter((c) => c.entity === 'mediaAsset')
      .map((c) => MediaAssetSchema.parse(c.row));
    expect(pulled).toEqual([row]);
  });

  it('QUALITY §6: firma el public_id de su carpeta, con una firma que Cloudinary puede comprobar', async () => {
    const row = asset();
    await push(user, [upsert(row)]);
    const res = await sign(user, row.id).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { uploadUrl, fields } = MediaSignatureSchema.parse(res.body);
    expect(uploadUrl).toBe('https://api.cloudinary.com/v1_1/estudio-pruebas/image/upload');
    expect(fields).toMatchObject({
      public_id: mediaPublicId(user.userId, row.id),
      timestamp: String(Math.floor(now / 1000)),
      api_key: '123456789012345',
    });
    const params = Object.fromEntries(
      Object.entries(fields).filter(([key]) => key !== 'api_key' && key !== 'signature'),
    );
    expect(fields.signature).toBe(signParams(params, 'secreto-de-pruebas'));
    expect(JSON.stringify(res.body)).not.toContain('secreto-de-pruebas');
  });

  it('no firma assets de otra cuenta, borrados ni desconocidos; sin sesión, 401', async () => {
    const foreign = asset();
    await push(other, [upsert(foreign)]);
    const deleted = asset({ deletedAt: now });
    await push(user, [upsert(deleted)]);
    for (const id of [foreign.id, deleted.id, newId()]) {
      const res = await sign(user, id).expect(404);
      expect((res.body as { code: string }).code).toBe('not_found');
    }
    await server.api().post('/media/signature').send({ assetId: foreign.id }).expect(401);
    await sign(user, 'no-es-uuid').expect(422);
  });

  it('al subirse guarda su public_id y su versión; un public_id de otra carpeta se rechaza', async () => {
    const row = asset();
    await push(user, [upsert(row)]);
    const later = { hlc: hlcAt(now + 1000, PHONE), updatedAt: now + 1000 };
    const uploaded = {
      ...row,
      ...later,
      publicId: mediaPublicId(user.userId, row.id),
      version: 1_760_000_123,
    };
    const stolen = {
      ...row,
      ...later,
      publicId: mediaPublicId(other.userId, row.id),
      version: 1_760_000_123,
    };
    const results = (await push(user, [upsert(stolen), upsert(uploaded)])).results;
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'forbidden'],
      ['applied', undefined],
    ]);
  });
});
