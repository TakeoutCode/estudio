import {
  CloudinaryUploadResultSchema,
  type ImageMime,
  type MediaAsset,
  MediaAssetSchema,
  type MediaSignature,
} from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import type { EstudioDb } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { ApiError } from '@/lib/api';

// FRONTEND §5, FE8: la imagen se guarda en el dispositivo con la nota y se sube cuando hay red.
// Sin red no hay error: espera en `pendingUploads` y se ve desde ahí (FE7).

/** Tablas de una escritura de media; van en la misma transacción que la nota que la usa. */
export const mediaTables = (database: EstudioDb) => [database.mediaAssets, database.pendingUploads];

/** Una imagen que ella eligió, ya revisada y leída, lista para guardarse con su nota. */
export interface StagedImage {
  readonly assetId: string;
  readonly data: ArrayBuffer;
  readonly mime: ImageMime;
  readonly width: number;
  readonly height: number;
}

/**
 * Crea el `MediaAsset` sin subir y deja sus bytes en la cola. Llamar dentro de una transacción
 * `rw` que incluya `mediaTables`, `outbox` y `meta` (FE3).
 */
export async function stageImageAsset(
  database: EstudioDb,
  image: StagedImage,
  now: number,
): Promise<MediaAsset> {
  const hlc = await nextHlc(database, now);
  const asset = MediaAssetSchema.parse({
    id: image.assetId,
    kind: 'image',
    mime: image.mime,
    bytes: image.data.byteLength,
    width: image.width,
    height: image.height,
    publicId: null,
    version: null,
    hlc,
    updatedAt: hlcWall(hlc),
    deletedAt: null,
  });
  await writeAndQueue(database, 'mediaAsset', asset, now);
  await database.pendingUploads.put({
    assetId: asset.id,
    data: image.data,
    mime: image.mime,
    createdAt: now,
    attempts: 0,
  });
  return asset;
}

/**
 * SY5: la imagen se borra con su nota (cada una es de una sola nota). Deja de subirse, y 90
 * días después la purga del servidor la borra de Cloudinary (SYNC §6). Llamar dentro de una
 * transacción `rw` que incluya `mediaTables`, `outbox` y `meta`.
 */
export async function softDeleteImageAsset(database: EstudioDb, assetId: string, now: number): Promise<void> {
  await database.pendingUploads.delete(assetId);
  const asset = await database.mediaAssets.get(assetId);
  if (asset?.deletedAt !== null) return;
  const hlc = await nextHlc(database, now);
  const updatedAt = hlcWall(hlc);
  await writeAndQueue(
    database,
    'mediaAsset',
    MediaAssetSchema.parse({ ...asset, hlc, updatedAt, deletedAt: updatedAt }),
    now,
  );
}

/** Red para subir: la firma de la API y el POST directo a Cloudinary (ARC8). */
export interface MediaUploadTransport {
  readonly sign: (assetId: string) => Promise<MediaSignature>;
  /** Devuelve el JSON de Cloudinary; lanza `ApiError('network')` si no hay conexión. */
  readonly upload: (signature: MediaSignature, file: Blob) => Promise<unknown>;
}

/**
 * Sube las imágenes pendientes, de la más antigua a la más nueva. Cada una que termina guarda
 * su `publicId` y `version` (LWW, con outbox) y deja de ocupar espacio en el dispositivo.
 * Devuelve cuántas subió. Sin red o sin Cloudinary configurado, se detiene sin error.
 */
export async function uploadPendingMedia(
  database: EstudioDb,
  transport: MediaUploadTransport,
  now: () => number = Date.now,
): Promise<number> {
  const pending = (await database.pendingUploads.toArray()).sort((a, b) => a.createdAt - b.createdAt);
  let uploaded = 0;
  for (const item of pending) {
    const asset = await database.mediaAssets.get(item.assetId);
    // Borrada, o ya subida (la app se cerró antes de limpiar la cola): nada que subir.
    if (asset?.deletedAt !== null || asset.publicId !== null) {
      await database.pendingUploads.delete(item.assetId);
      continue;
    }
    let result: unknown;
    try {
      const signature = await transport.sign(asset.id);
      result = await transport.upload(signature, new Blob([item.data], { type: item.mime }));
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'network' || error.code === 'unavailable')) break;
      // `not_found`: el asset todavía no llegó al servidor; sale en la próxima vuelta.
      if (!(error instanceof ApiError && error.code === 'not_found')) {
        await database.pendingUploads.update(item.assetId, { attempts: item.attempts + 1 });
      }
      continue;
    }
    const parsed = CloudinaryUploadResultSchema.safeParse(result);
    if (!parsed.success) {
      await database.pendingUploads.update(item.assetId, { attempts: item.attempts + 1 });
      continue;
    }
    const { public_id: publicId, version } = parsed.data;
    await database.transaction('rw', [...mediaTables(database), database.outbox, database.meta], async () => {
      const current = await database.mediaAssets.get(item.assetId);
      if (current?.deletedAt === null) {
        const at = now();
        const hlc = await nextHlc(database, at);
        const row = MediaAssetSchema.parse({ ...current, publicId, version, hlc, updatedAt: hlcWall(hlc) });
        await writeAndQueue(database, 'mediaAsset', row, at);
      }
      await database.pendingUploads.delete(item.assetId);
    });
    uploaded += 1;
  }
  return uploaded;
}
