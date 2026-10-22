import { type ApiErrorCode, type MediaAsset, mediaPublicId } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { MediaPurger } from './media-purger.js';
import { MediaRepository } from './media.repository.js';

/** FE8: la imagen de una nota (LWW). Al subirse, el dispositivo escribe su `publicId`. */
@Injectable()
@SyncHandler('mediaAsset')
export class MediaAssetSyncHandler implements EntitySyncHandler<'mediaAsset'> {
  readonly entity = 'mediaAsset';
  readonly table = 'media_asset';

  constructor(
    private readonly repo: MediaRepository,
    private readonly purger: MediaPurger,
  ) {}

  /** SYNC §6: la imagen se borra de Cloudinary antes de purgar su fila; si no, espera. */
  beforePurge(userId: string, ids: readonly string[]): Promise<readonly string[]> {
    return this.purger.deleteAssets(userId, ids);
  }

  /** QUALITY §6: solo puede apuntar al `public_id` que la API firma para esta cuenta. */
  check(userId: string, row: MediaAsset): ApiErrorCode | null {
    return row.publicId === null || row.publicId === mediaPublicId(userId, row.id) ? null : 'forbidden';
  }

  apply(userId: string, row: MediaAsset): Promise<ApplyStatus> {
    return this.repo.upsertMediaAssetLww(userId, row);
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      kind: d.kind,
      mime: d.mime,
      bytes: dbNumber(d.bytes),
      width: dbNumber(d.width),
      height: dbNumber(d.height),
      publicId: d.public_id,
      version: dbNumberOrNull(d.version),
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
