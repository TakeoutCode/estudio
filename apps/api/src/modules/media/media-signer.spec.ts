import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { CloudinarySigner, parseCloudinaryUrl, signParams } from './media-signer.js';

const configWith = (url: string | undefined) => ({ get: () => url }) as unknown as AppConfig;

describe('firma de subida a Cloudinary (ADR-010, ARC8)', () => {
  it('firma como documenta Cloudinary: parámetros en orden, más el secreto, en SHA-1', () => {
    // Ejemplo de "Generating authentication signatures" en la documentación de Cloudinary.
    expect(
      signParams(
        { timestamp: '1315060510', public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' },
        'abcd',
      ),
    ).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('lee clave, secreto y nube de CLOUDINARY_URL; sin ella no hay cuenta', () => {
    expect(parseCloudinaryUrl('cloudinary://123:abc@mi-nube')).toEqual({
      apiKey: '123',
      apiSecret: 'abc',
      cloudName: 'mi-nube',
    });
    expect(parseCloudinaryUrl(undefined)).toBeNull();
    expect(new CloudinarySigner(configWith(undefined)).sign({ publicId: 'x', timestampSec: 1 })).toBeNull();
  });

  it('QUALITY §6: fija el public_id y los formatos; el secreto no viaja', () => {
    const signer = new CloudinarySigner(configWith('cloudinary://123:secreto@mi-nube'));
    const signature = signer.sign({ publicId: 'estudio/u/a', timestampSec: 1_760_000_000 });
    expect(signature?.uploadUrl).toBe('https://api.cloudinary.com/v1_1/mi-nube/image/upload');
    const fields = signature?.fields ?? {};
    expect(fields).toMatchObject({
      public_id: 'estudio/u/a',
      timestamp: '1760000000',
      allowed_formats: 'jpg,png,webp,gif,heic',
      api_key: '123',
    });
    const params = Object.fromEntries(
      Object.entries(fields).filter(([key]) => key !== 'api_key' && key !== 'signature'),
    );
    expect(fields.signature).toBe(signParams(params, 'secreto'));
    expect(JSON.stringify(signature)).not.toContain('secreto');
  });
});
