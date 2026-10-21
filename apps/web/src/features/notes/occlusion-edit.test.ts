import { OCCLUSION_MAX_GROUPS, OcclusionRectSchema } from '@estudio/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addRect,
  fitRect,
  MAX_RECTS_PER_GROUP,
  MIN_SIDE,
  moveBy,
  nextGroupNumber,
  rectBetween,
  removeRect,
  resizeBy,
  updateRect,
} from './occlusion-edit';

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

describe('edición de máscaras de oclusión (LD §1)', () => {
  it('cualquier recuadro ajustado queda dentro de la imagen y pasa el esquema', () => {
    const coord = fc.double({ min: -2, max: 3, noNaN: true });
    fc.assert(
      fc.property(coord, coord, coord, coord, (x, y, w, h) => {
        const fitted = fitRect({ x, y, w, h });
        expect(OcclusionRectSchema.safeParse(fitted).success).toBe(true);
        expect(fitted.w).toBeGreaterThanOrEqual(MIN_SIDE - 1e-4);
      }),
    );
  });

  it('un arrastre en cualquier dirección da el mismo recuadro; uno muy corto no cuenta', () => {
    const a = { x: 0.6, y: 0.7 };
    const b = { x: 0.2, y: 0.4 };
    expect(rectBetween(a, b)).toEqual({ x: 0.2, y: 0.4, w: 0.4, h: 0.3 });
    expect(rectBetween(b, a)).toEqual(rectBetween(a, b));
    expect(rectBetween(a, { x: 0.61, y: 0.9 })).toBeNull();
    expect(rectBetween({ x: -0.5, y: 0.5 }, { x: 0.2, y: 1.4 })).toEqual({ x: 0, y: 0.5, w: 0.2, h: 0.5 });
  });

  it('dibujar crea una etiqueta nueva con el siguiente número, o suma un recuadro a una existente', () => {
    const first = addRect([], 'new', rect);
    expect(first?.groups).toEqual([{ n: 1, label: '', rects: [rect] }]);
    expect(first?.selected).toEqual({ n: 1, index: 0 });
    const second = addRect(first?.groups ?? [], 1, { ...rect, x: 0.5 });
    expect(second?.groups[0]?.rects).toHaveLength(2);
    expect(second?.selected).toEqual({ n: 1, index: 1 });
    // Los números no se reutilizan: son el ordinal de la Card y su historial.
    expect(
      nextGroupNumber([
        { n: 1, label: 'a', rects: [rect] },
        { n: 4, label: 'b', rects: [rect] },
      ]),
    ).toBe(5);
  });

  it('respeta los máximos de etiquetas y de recuadros por etiqueta', () => {
    const many = Array.from({ length: OCCLUSION_MAX_GROUPS }, (_, i) => ({
      n: i + 1,
      label: 'x',
      rects: [rect],
    }));
    expect(addRect(many, 'new')).toBeNull();
    const full = [{ n: 1, label: 'x', rects: Array.from({ length: MAX_RECTS_PER_GROUP }, () => rect) }];
    expect(addRect(full, 1)).toBeNull();
  });

  it('mover se detiene en el borde sin encoger; agrandar no pasa del borde', () => {
    const groups = [{ n: 1, label: 'x', rects: [rect] }];
    const moved = updateRect(groups, { n: 1, index: 0 }, (r) => moveBy(r, 2, -1));
    expect(moved[0]?.rects[0]).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.1 });
    const grown = updateRect(groups, { n: 1, index: 0 }, (r) => resizeBy(r, 5, 5));
    expect(grown[0]?.rects[0]).toEqual({ x: 0.1, y: 0.2, w: 0.9, h: 0.8 });
    const shrunk = updateRect(groups, { n: 1, index: 0 }, (r) => resizeBy(r, -1, -1));
    expect(shrunk[0]?.rects[0]).toEqual({ x: 0.1, y: 0.2, w: MIN_SIDE, h: MIN_SIDE });
  });

  it('quitar el último recuadro de una etiqueta quita la etiqueta', () => {
    const groups = [
      { n: 1, label: 'a', rects: [rect, { ...rect, x: 0.5 }] },
      { n: 2, label: 'b', rects: [rect] },
    ];
    expect(removeRect(groups, { n: 1, index: 0 })).toEqual([
      { n: 1, label: 'a', rects: [{ ...rect, x: 0.5 }] },
      { n: 2, label: 'b', rects: [rect] },
    ]);
    expect(removeRect(groups, { n: 2, index: 0 }).map((g) => g.n)).toEqual([1]);
  });
});
