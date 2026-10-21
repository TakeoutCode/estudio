import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import {
  CloudinaryUploadResultSchema,
  IMAGE_MAX_BYTES,
  MediaAssetSchema,
  mediaPublicId,
  MediaSignatureSchema,
} from './media.js';

const asset = (overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
  kind: 'image',
  mime: 'image/jpeg',
  bytes: 350_000,
  width: 1200,
  height: 900,
  publicId: null,
  version: null,
  ...overrides,
});

describe('MediaAsset (FRONTEND §5, FE8)', () => {
  it('se sincroniza como LWW y empieza sin subir', () => {
    expect(SYNC_ROW_SCHEMAS.mediaAsset).toBe(MediaAssetSchema);
    expect(MediaAssetSchema.safeParse(asset()).success).toBe(true);
  });

  it('publicId y version llegan juntos al subirse', () => {
    expect(
      MediaAssetSchema.safeParse(asset({ publicId: 'estudio/u/a', version: 1_760_000_000 })).success,
    ).toBe(true);
    expect(MediaAssetSchema.safeParse(asset({ publicId: 'estudio/u/a' })).success).toBe(false);
    expect(MediaAssetSchema.safeParse(asset({ version: 1_760_000_000 })).success).toBe(false);
  });

  it('rechaza lo que pasa del límite de 10 MB, formatos que no son imagen y medidas vacías', () => {
    expect(MediaAssetSchema.safeParse(asset({ bytes: IMAGE_MAX_BYTES })).success).toBe(true);
    expect(MediaAssetSchema.safeParse(asset({ bytes: IMAGE_MAX_BYTES + 1 })).success).toBe(false);
    expect(MediaAssetSchema.safeParse(asset({ mime: 'image/svg+xml' })).success).toBe(false);
    expect(MediaAssetSchema.safeParse(asset({ width: 0 })).success).toBe(false);
  });

  it('QUALITY §6: el public_id vive en la carpeta de su cuenta', () => {
    const userId = newId();
    const assetId = newId();
    expect(mediaPublicId(userId, assetId)).toBe(`estudio/${userId}/${assetId}`);
  });

  it('la firma solo se acepta con una URL https', () => {
    const fields = { api_key: '1', signature: 'abc' };
    expect(
      MediaSignatureSchema.safeParse({ uploadUrl: 'https://api.cloudinary.com/x', fields }).success,
    ).toBe(true);
    expect(MediaSignatureSchema.safeParse({ uploadUrl: 'http://api.cloudinary.com/x', fields }).success).toBe(
      false,
    );
  });

  it('de la respuesta de Cloudinary toma public_id y version e ignora el resto', () => {
    const parsed = CloudinaryUploadResultSchema.parse({
      public_id: 'estudio/u/a',
      version: 1_760_000_000,
      secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/estudio/u/a.jpg',
    });
    expect(parsed).toEqual({ public_id: 'estudio/u/a', version: 1_760_000_000 });
  });
});
