import { MediaAssetSchema, MutationSchema, newId } from '@estudio/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { ApiError } from '@/lib/api';
import {
  mediaTables,
  type MediaUploadTransport,
  type StagedImage,
  stageImageAsset,
  uploadPendingMedia,
} from './commands';

const T0 = Date.UTC(2026, 9, 20, 15);

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

const image = (overrides: Partial<StagedImage> = {}): StagedImage => ({
  assetId: newId(),
  data: new Uint8Array([1, 2, 3, 4]).buffer,
  mime: 'image/png',
  width: 800,
  height: 600,
  ...overrides,
});

// Dexie sigue la transacción a través de `await` solo si la función es `async`.
const stage = (staged: StagedImage, now = T0) =>
  db.transaction('rw', [...mediaTables(db), db.outbox, db.meta], async () => {
    return await stageImageAsset(db, staged, now);
  });

const signature = {
  uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
  fields: { api_key: '1' },
};

/** Cloudinary falso: devuelve el public_id que la API habría firmado. */
const fakeTransport = (overrides: Partial<MediaUploadTransport> = {}): MediaUploadTransport => ({
  sign: vi.fn(() => Promise.resolve(signature)),
  upload: vi.fn(() => Promise.resolve({ public_id: 'estudio/u/a', version: 1_760_000_000, bytes: 4 })),
  ...overrides,
});

describe('media en el dispositivo (FRONTEND §5, FE8)', () => {
  it('guardar una imagen crea el asset sin subir, lo encola y deja sus bytes aquí', async () => {
    const staged = image();
    const asset = await stage(staged);
    expect(asset).toMatchObject({ id: staged.assetId, bytes: 4, width: 800, publicId: null, version: null });
    expect(MediaAssetSchema.safeParse(await db.mediaAssets.get(staged.assetId)).success).toBe(true);
    const [entry] = await db.outbox.toArray();
    expect(entry?.entity).toBe('mediaAsset');
    expect(MutationSchema.safeParse(entry).success).toBe(true);
    const copy = await db.pendingUploads.get(staged.assetId);
    expect(copy && [...new Uint8Array(copy.data)]).toEqual([1, 2, 3, 4]);
  });

  it('al subirse guarda publicId y versión con un HLC nuevo y libera la copia', async () => {
    const staged = image();
    const before = await stage(staged);
    const transport = fakeTransport();
    expect(await uploadPendingMedia(db, transport, () => T0 + 1000)).toBe(1);
    expect(transport.sign).toHaveBeenCalledWith(staged.assetId);
    const after = await db.mediaAssets.get(staged.assetId);
    expect(after).toMatchObject({ publicId: 'estudio/u/a', version: 1_760_000_000 });
    expect(after?.hlc && after.hlc > before.hlc).toBe(true);
    expect(await db.pendingUploads.count()).toBe(0);
    expect((await db.outbox.toArray()).map((e) => e.entity)).toEqual(['mediaAsset', 'mediaAsset']);
  });

  it('FE7: sin red se detiene sin error y la copia sigue esperando', async () => {
    const staged = image();
    await stage(staged);
    const transport = fakeTransport({ sign: () => Promise.reject(new ApiError(0, 'network')) });
    expect(await uploadPendingMedia(db, transport)).toBe(0);
    expect(await db.pendingUploads.get(staged.assetId)).toMatchObject({ attempts: 0 });
  });

  it('sin Cloudinary configurado (503) se detiene; la imagen se sigue viendo desde aquí', async () => {
    await stage(image());
    await stage(image(), T0 + 1);
    const transport = fakeTransport({ sign: vi.fn(() => Promise.reject(new ApiError(503, 'unavailable'))) });
    expect(await uploadPendingMedia(db, transport)).toBe(0);
    expect(transport.sign).toHaveBeenCalledTimes(1);
    expect(await db.pendingUploads.count()).toBe(2);
  });

  it('si el asset todavía no llegó al servidor, espera sin contar intento y sigue con las demás', async () => {
    const first = image();
    const second = image();
    await stage(first);
    await stage(second, T0 + 1);
    const transport = fakeTransport({
      sign: (assetId) =>
        assetId === first.assetId
          ? Promise.reject(new ApiError(404, 'not_found'))
          : Promise.resolve(signature),
    });
    expect(await uploadPendingMedia(db, transport)).toBe(1);
    expect(await db.pendingUploads.get(first.assetId)).toMatchObject({ attempts: 0 });
    expect(await db.pendingUploads.get(second.assetId)).toBeUndefined();
  });

  it('un rechazo de Cloudinary o una respuesta rara cuentan como intento fallido', async () => {
    const rejected = image();
    const odd = image();
    await stage(rejected);
    await stage(odd, T0 + 1);
    let calls = 0;
    const transport = fakeTransport({
      upload: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new ApiError(400, 'validation_failed'))
          : Promise.resolve({ ok: true });
      },
    });
    expect(await uploadPendingMedia(db, transport)).toBe(0);
    expect(await db.pendingUploads.get(rejected.assetId)).toMatchObject({ attempts: 1 });
    expect(await db.pendingUploads.get(odd.assetId)).toMatchObject({ attempts: 1 });
    expect((await db.mediaAssets.get(odd.assetId))?.publicId).toBeNull();
  });

  it('un asset borrado o ya subido no se sube y su copia se libera', async () => {
    const deleted = image();
    const asset = await stage(deleted);
    await db.mediaAssets.put({ ...asset, deletedAt: T0 });
    const uploaded = image();
    const other = await stage(uploaded, T0 + 1);
    await db.mediaAssets.put({ ...other, publicId: 'estudio/u/b', version: 1 });
    const transport = fakeTransport();
    expect(await uploadPendingMedia(db, transport)).toBe(0);
    expect(transport.sign).not.toHaveBeenCalled();
    expect(await db.pendingUploads.count()).toBe(0);
  });
});
