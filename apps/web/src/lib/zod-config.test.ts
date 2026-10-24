import { describe, expect, it } from 'vitest';
import './zod-config';
import { z } from 'zod';

describe('zod sin eval (QUALITY §6, CSP)', () => {
  it('zod toma `jitless` del global que fija zod-config, sin que nadie lo importe antes', () => {
    // Si una versión nueva de zod deja de leer `__zod_globalConfig`, esto falla y la CSP vuelve a
    // registrar una violación en cada carga.
    expect(z.config().jitless).toBe(true);
    expect(z.object({ a: z.string() }).parse({ a: 'x' })).toEqual({ a: 'x' });
  });
});
