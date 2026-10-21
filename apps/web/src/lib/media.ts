import { IMAGE_MAX_BYTES, IMAGE_MIME_TYPES, type ImageMime } from '@estudio/shared';

// FRONTEND §5: URLs de Cloudinary y revisión del archivo antes de pedir la firma. Sin Dexie
// ni red: lo usan los componentes y la feature `media`.

/**
 * Anchos que se piden a Cloudinary. Pocos y fijos, para que la misma imagen tenga la misma URL
 * en el estudio y en la precarga, y el service worker la sirva sin red (FE7).
 */
const LARGEST_WIDTH = 1600;
const DELIVERY_WIDTHS = [400, 800, 1200, LARGEST_WIDTH] as const;
/** Más de 2× no se distingue en el teléfono y triplica los bytes. */
const MAX_DPR = 2;

export function deliveryWidth(cssWidth: number, dpr: number): number {
  const wanted = cssWidth * Math.min(Math.max(dpr, 1), MAX_DPR);
  return DELIVERY_WIDTHS.find((w) => w >= wanted) ?? LARGEST_WIDTH;
}

/** FE8: `f_auto,q_auto` y el ancho según DPR; `c_limit` nunca agranda una imagen chica. */
export function cloudinaryImageUrl(input: {
  readonly cloudName: string;
  readonly publicId: string;
  readonly version: number;
  readonly width: number;
}): string {
  const { cloudName, publicId, version, width } = input;
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/f_auto,q_auto,c_limit,w_${String(width)}/v${String(version)}/${publicId}`;
}

export type ImageFileProblem = 'type' | 'size';

/** Lo que se revisa antes de guardar: formato que se puede subir y el límite de 10 MB. */
export function checkImageFile(file: {
  readonly type: string;
  readonly size: number;
}): ImageFileProblem | null {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return 'type';
  return file.size > IMAGE_MAX_BYTES ? 'size' : null;
}

export const isImageMime = (type: string): type is ImageMime =>
  (IMAGE_MIME_TYPES as readonly string[]).includes(type);

/**
 * Medidas tal como se ve, con la orientación EXIF aplicada (como la dibuja `<img>`): las
 * máscaras se guardan en 0-1 sobre esto.
 */
export async function readImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
