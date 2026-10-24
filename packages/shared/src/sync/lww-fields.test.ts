import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTRACT_VERSION, MIN_SAFE_CONTRACT } from '../contract.js';
import { ENTITY_STRATEGY } from './entities.js';
import { SYNC_ROW_SCHEMAS } from './row-schemas.js';

/** Las rutas de campos de un JSON Schema (`note.content.kind`, `userSettings.data.timer.focusMin`…). */
function fieldPaths(node: unknown, prefix: string, out: Set<string>): void {
  if (typeof node !== 'object' || node === null) return;
  const schema = node as Record<string, unknown>;
  if (typeof schema.properties === 'object' && schema.properties !== null) {
    for (const [key, child] of Object.entries(schema.properties)) {
      out.add(`${prefix}.${key}`);
      fieldPaths(child, `${prefix}.${key}`, out);
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variants = schema[key];
    if (Array.isArray(variants)) for (const variant of variants) fieldPaths(variant, prefix, out);
  }
  if (schema.items !== undefined) fieldPaths(schema.items, `${prefix}[]`, out);
}

/** FNV-1a de 32 bits: una huella corta y estable de la lista de campos. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const lwwFields = (): string[] => {
  const out = new Set<string>();
  for (const [entity, schema] of Object.entries(SYNC_ROW_SCHEMAS)) {
    if (ENTITY_STRATEGY[entity as keyof typeof SYNC_ROW_SCHEMAS] !== 'lww') continue;
    fieldPaths(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), entity, out);
  }
  return [...out].sort();
};

describe('ARC6: campos de las entidades LWW frente a MIN_SAFE_CONTRACT', () => {
  it('ARC6: agregar o quitar un campo LWW obliga a revisar MIN_SAFE_CONTRACT', () => {
    // Si esto falla, cambió la forma de una entidad LWW o de UserSettings. Si agregaste un campo,
    // sube CONTRACT_VERSION y MIN_SAFE_CONTRACT al mismo número: un cliente viejo lo borraría al
    // editar la fila. Si fue otro cambio, revisa que un cliente viejo pueda seguir escribiendo.
    // Después actualiza aquí la huella.
    expect({ minSafe: MIN_SAFE_CONTRACT, fields: fnv1a(lwwFields().join('\n')) }).toEqual({
      minSafe: 27,
      fields: '8d6f3ba6',
    });
  });

  it('ARC6: el mínimo seguro nunca pasa del contrato actual', () => {
    expect(MIN_SAFE_CONTRACT).toBeLessThanOrEqual(CONTRACT_VERSION);
    expect(lwwFields()).toEqual(
      expect.arrayContaining(['note.tagIds', 'note.mnemonic', 'selfExplanation.kind']),
    );
  });
});
