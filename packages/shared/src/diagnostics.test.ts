import { describe, expect, it } from 'vitest';
import {
  CLIENT_ERROR_LIMITS,
  ClientErrorReportSchema,
  ClientErrorSchema,
  HealthChecksSchema,
  redactErrorText,
  redactRoute,
} from './diagnostics.js';
import { newId } from './ids.js';

const error = (overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  message: 'TypeError: x is undefined',
  stack: null,
  route: '/study',
  appVersion: '19',
  occurredAt: 1_760_000_000_000,
  ...overrides,
});

describe('FE13: errores del cliente sin contenido', () => {
  it('tapa lo citado (puede ser texto de ella) y los ids, y recorta', () => {
    expect(redactErrorText(`SyntaxError: "El fémur es el hueso más largo" is not valid JSON`, 300)).toBe(
      'SyntaxError: "…" is not valid JSON',
    );
    expect(redactErrorText("Cannot read properties of undefined (reading 'front')", 300)).toBe(
      'Cannot read properties of undefined (reading "…")',
    );
    expect(redactErrorText('nota 0192f1a0-0000-7000-8000-00000000c0de no existe', 300)).toBe(
      'nota :id no existe',
    );
    expect(redactErrorText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('la ruta va sin búsqueda, fragmento ni ids', () => {
    expect(
      redactRoute('/notes/0192f1a0-0000-7000-8000-00000000c0de?mazo=0192f1a0-0000-7000-8000-00000000c0df#x'),
    ).toBe('/notes/:id');
    expect(redactRoute('/study')).toBe('/study');
  });

  it('el lote trae de 1 a 20 errores dentro de sus límites, sin campos de más', () => {
    expect(ClientErrorReportSchema.safeParse({ errors: [error()] }).success).toBe(true);
    expect(ClientErrorReportSchema.safeParse({ errors: [] }).success).toBe(false);
    const many = Array.from({ length: CLIENT_ERROR_LIMITS.perDay + 1 }, () => error());
    expect(ClientErrorReportSchema.safeParse({ errors: many }).success).toBe(false);
    expect(ClientErrorSchema.safeParse(error({ message: 'x'.repeat(301) })).success).toBe(false);
    expect(ClientErrorSchema.safeParse(error({ answer: 'el fémur' })).success).toBe(false);
  });

  it('QA8: los chequeos solo dicen qué falla', () => {
    expect(HealthChecksSchema.safeParse({ status: 'failing', failing: ['cron_stale'] }).success).toBe(true);
    expect(HealthChecksSchema.safeParse({ status: 'failing', failing: ['otro'] }).success).toBe(false);
    expect(HealthChecksSchema.safeParse({ status: 'ok', failing: [], detail: 'x' }).success).toBe(false);
  });
});
