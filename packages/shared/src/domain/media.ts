import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

// Media (ARCHITECTURE §3, FRONTEND §5, ADR-010). La nota guarda el `MediaAsset.id`, nunca una
// URL (FE8): sin red, la imagen se ve desde su copia local, y al subirse solo cambian
// `publicId` y `version`. Por ahora solo imágenes (oclusión, R10).

/** FRONTEND §5: límite técnico antes de pedir la firma; no es un umbral de estudio (AG4). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Formatos que el navegador decodifica y Cloudinary acepta; la firma los fija (QUALITY §6). */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'] as const;
export const ImageMimeSchema = z.enum(IMAGE_MIME_TYPES);
export type ImageMime = z.infer<typeof ImageMimeSchema>;

const pixels = () => z.number().int().min(1).max(20_000);

/**
 * QUALITY §6: todo lo de ella va bajo `estudio/<userId>/`; la API firma solo ese `public_id` y
 * rechaza un asset que apunte a otro.
 */
export const mediaPublicId = (userId: string, assetId: string): string => `estudio/${userId}/${assetId}`;

export const MediaAssetSchema = SyncMetaSchema.extend({
  kind: z.literal('image'),
  mime: ImageMimeSchema,
  bytes: z.number().int().min(1).max(IMAGE_MAX_BYTES),
  /** Medidas tal como se ve (con la orientación EXIF aplicada): las máscaras van en 0-1 sobre esto. */
  width: pixels(),
  height: pixels(),
  /** `null` hasta que la subida termina; entonces lo llena el dispositivo que la subió. */
  publicId: z.string().min(1).max(255).nullable(),
  version: z.number().int().positive().nullable(),
})
  .strict()
  .refine((asset) => (asset.publicId === null) === (asset.version === null), {
    path: ['version'],
    message: 'public_id_and_version_together',
  });
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

/** `POST /media/signature`: el asset ya tiene que estar en el servidor (llegó por push). */
export const MediaSignatureRequestSchema = z.object({ assetId: z.uuid() }).strict();
export type MediaSignatureRequest = z.infer<typeof MediaSignatureRequestSchema>;

/**
 * ARC8: firma de vida corta. `fields` va tal cual en el `FormData`, junto con el archivo, en un
 * POST a `uploadUrl`; la API decide qué se firma.
 */
export const MediaSignatureSchema = z
  .object({
    uploadUrl: z.url({ protocol: /^https$/ }),
    fields: z.record(z.string(), z.string()),
  })
  .strict();
export type MediaSignature = z.infer<typeof MediaSignatureSchema>;

/** Lo que usa la web de la respuesta de Cloudinary a una subida (AG2); el resto se ignora. */
export const CloudinaryUploadResultSchema = z.object({
  public_id: z.string().min(1).max(255),
  version: z.number().int().positive(),
});
export type CloudinaryUploadResult = z.infer<typeof CloudinaryUploadResultSchema>;
