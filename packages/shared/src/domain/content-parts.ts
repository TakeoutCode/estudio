import { z } from 'zod';

// Piezas comunes del contenido de notas y ejercicios (LEARNING-DESIGN §1 y §2).

/** LD4: la explicación breve que se muestra tras cada intento (R4). */
export const EXPLANATION_MAX_LENGTH = 400;

export const text = (max: number) => z.string().trim().min(1).max(max);

export const explanation = () => z.string().trim().max(EXPLANATION_MAX_LENGTH);

/** Coordenada normalizada sobre la imagen tal como se ve: 0 es el borde izquierdo o superior. */
const unit = () => z.number().min(0).max(1);

/** Tolerancia de redondeo: con 4 decimales, `x + w` puede pasar de 1 por muy poco. */
const EDGE_TOLERANCE = 1e-6;

/** Un recuadro que tapa una etiqueta de la imagen. */
export const OcclusionRectSchema = z
  .object({ x: unit(), y: unit(), w: unit().positive(), h: unit().positive() })
  .strict()
  .refine((r) => r.x + r.w <= 1 + EDGE_TOLERANCE && r.y + r.h <= 1 + EDGE_TOLERANCE, 'rect_outside_image');
export type OcclusionRect = z.infer<typeof OcclusionRectSchema>;

/**
 * Una etiqueta y los recuadros que la tapan (a veces aparece en dos lugares). `n` es su número
 * estable, como el de un hueco cloze: en una oclusión es el `ordinal` de su Card, así que quitar
 * otra etiqueta no cambia de qué Card es el historial.
 */
export const OcclusionGroupSchema = z
  .object({
    n: z.number().int().min(1).max(999),
    label: text(200),
    rects: z.array(OcclusionRectSchema).min(1).max(10),
  })
  .strict();
export type OcclusionGroup = z.infer<typeof OcclusionGroupSchema>;
