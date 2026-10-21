import { OCCLUSION_MAX_GROUPS, type OcclusionGroup, type OcclusionRect } from '@estudio/shared';

// Edición de las máscaras de una nota de oclusión (LD §1): funciones puras sobre coordenadas
// normalizadas de 0 a 1, para que el editor solo traduzca punteros y teclas.

/** Lado mínimo de un recuadro: más chico no se puede tocar ni ver (diseño de la UI). */
export const MIN_SIDE = 0.02;
/** Lo que mueve o agranda una flecha del teclado. */
export const KEY_STEP = 0.01;
/** Recuadro que agrega "Agregar recuadro" (sin puntero), en el centro de la imagen. */
const DEFAULT_RECT: OcclusionRect = { x: 0.4, y: 0.45, w: 0.2, h: 0.1 };

export const MAX_RECTS_PER_GROUP = 10;

/** Un recuadro elegido: su etiqueta (`n`) y su lugar dentro de ella. */
export interface RectRef {
  readonly n: number;
  readonly index: number;
}

/** A dónde va lo que se dibuja: una etiqueta nueva o una que ya existe (aparece dos veces). */
export type DrawTarget = 'new' | number;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 4 decimales bastan para una imagen de 10 000 px y dejan el JSON corto. */
const round = (v: number) => Math.round(v * 10_000) / 10_000;

/** Lo deja dentro de la imagen sin moverlo (recorta el tamaño), con el lado mínimo y redondeado. */
export function fitRect(r: OcclusionRect): OcclusionRect {
  const x = round(Math.min(1 - MIN_SIDE, clamp01(r.x)));
  const y = round(Math.min(1 - MIN_SIDE, clamp01(r.y)));
  return {
    x,
    y,
    w: round(Math.min(1 - x, Math.max(MIN_SIDE, r.w))),
    h: round(Math.min(1 - y, Math.max(MIN_SIDE, r.h))),
  };
}

/** El recuadro entre dos puntos de un arrastre; `null` si quedó demasiado chico. */
export function rectBetween(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): OcclusionRect | null {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  const w = clamp01(Math.max(a.x, b.x)) - x;
  const h = clamp01(Math.max(a.y, b.y)) - y;
  return w < MIN_SIDE || h < MIN_SIDE ? null : fitRect({ x, y, w, h });
}

export const nextGroupNumber = (groups: readonly OcclusionGroup[]): number =>
  Math.max(0, ...groups.map((g) => g.n)) + 1;

/** Agrega un recuadro (por defecto, el del centro) y lo deja elegido. */
export function addRect(
  groups: readonly OcclusionGroup[],
  target: DrawTarget,
  rect: OcclusionRect = DEFAULT_RECT,
): { readonly groups: OcclusionGroup[]; readonly selected: RectRef } | null {
  const existing = target === 'new' ? undefined : groups.find((g) => g.n === target);
  if (existing) {
    if (existing.rects.length >= MAX_RECTS_PER_GROUP) return null;
    return {
      groups: groups.map((g) => (g.n === existing.n ? { ...g, rects: [...g.rects, fitRect(rect)] } : g)),
      selected: { n: existing.n, index: existing.rects.length },
    };
  }
  if (groups.length >= OCCLUSION_MAX_GROUPS) return null;
  const n = nextGroupNumber(groups);
  return { groups: [...groups, { n, label: '', rects: [fitRect(rect)] }], selected: { n, index: 0 } };
}

export function updateRect(
  groups: readonly OcclusionGroup[],
  ref: RectRef,
  change: (rect: OcclusionRect) => OcclusionRect,
): OcclusionGroup[] {
  return groups.map((g) =>
    g.n === ref.n ? { ...g, rects: g.rects.map((r, i) => (i === ref.index ? fitRect(change(r)) : r)) } : g,
  );
}

/** Mueve sin cambiar el tamaño: en el borde se detiene en vez de encogerse. */
export const moveBy = (r: OcclusionRect, dx: number, dy: number): OcclusionRect => ({
  ...r,
  x: Math.min(1 - r.w, Math.max(0, r.x + dx)),
  y: Math.min(1 - r.h, Math.max(0, r.y + dy)),
});

export const resizeBy = (r: OcclusionRect, dw: number, dh: number): OcclusionRect => ({
  ...r,
  w: r.w + dw,
  h: r.h + dh,
});

/** Quita un recuadro; si era el último de su etiqueta, quita la etiqueta. */
export function removeRect(groups: readonly OcclusionGroup[], ref: RectRef): OcclusionGroup[] {
  return groups.flatMap((g) => {
    if (g.n !== ref.n) return [g];
    const rects = g.rects.filter((_, i) => i !== ref.index);
    return rects.length > 0 ? [{ ...g, rects }] : [];
  });
}
