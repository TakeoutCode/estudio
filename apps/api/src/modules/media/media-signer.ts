import { createHash } from 'node:crypto';
import type { MediaSignature } from '@estudio/shared';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { CLOUDINARY_URL } from '../../config/env.js';

/** Lo que se firma para una subida: el `public_id` ya incluye la carpeta de su cuenta. */
export interface UploadRequest {
  readonly publicId: string;
  /** Epoch en segundos; Cloudinary rechaza la firma pasada una hora. */
  readonly timestampSec: number;
}

/** BE13: puerto hacia Cloudinary; `null` si no está configurado (desarrollo sin cuenta). */
export abstract class MediaSigner {
  abstract sign(request: UploadRequest): MediaSignature | null;
}

/** QUALITY §6: solo estos formatos; coinciden con `IMAGE_MIME_TYPES` de shared. */
const ALLOWED_FORMATS = 'jpg,png,webp,gif,heic';

/**
 * Firma de Cloudinary: los parámetros en orden alfabético como `k=v` unidos con `&`, más el
 * secreto, en SHA-1 hexadecimal. No entran `file`, `api_key`, `resource_type` ni `cloud_name`.
 */
export function signParams(params: Readonly<Record<string, string>>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key] ?? ''}`)
    .join('&');
  return createHash('sha1')
    .update(payload + apiSecret)
    .digest('hex');
}

interface CloudinaryAccount {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly cloudName: string;
}

export function parseCloudinaryUrl(url: string | undefined): CloudinaryAccount | null {
  const match = url === undefined ? null : CLOUDINARY_URL.exec(url);
  const [, apiKey, apiSecret, cloudName] = match ?? [];
  return apiKey && apiSecret && cloudName ? { apiKey, apiSecret, cloudName } : null;
}

/** ADR-010, ARC8: firma local de vida corta; el secreto nunca sale de la API. */
@Injectable()
export class CloudinarySigner extends MediaSigner {
  private readonly account: CloudinaryAccount | null;

  constructor(config: AppConfig) {
    super();
    this.account = parseCloudinaryUrl(config.get('CLOUDINARY_URL'));
    if (!this.account) new Logger(CloudinarySigner.name).warn('Sin CLOUDINARY_URL: las imágenes no se suben');
  }

  sign({ publicId, timestampSec }: UploadRequest): MediaSignature | null {
    if (!this.account) return null;
    const signed = {
      allowed_formats: ALLOWED_FORMATS,
      public_id: publicId,
      timestamp: String(timestampSec),
    };
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.account.cloudName}/image/upload`,
      fields: {
        ...signed,
        api_key: this.account.apiKey,
        signature: signParams(signed, this.account.apiSecret),
      },
    };
  }
}
