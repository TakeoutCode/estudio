import { AiNoteDraftSchema } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { strictJsonSchema } from './strict-json-schema.js';

describe('LD15: JSON Schema estricto para el modelo', () => {
  const schema = strictJsonSchema(z.object({ drafts: z.array(AiNoteDraftSchema) }).strict());

  it('todo objeto exige todos sus campos y ninguno de más; lo opcional va como nullable', () => {
    expect(schema).toMatchObject({ type: 'object', required: ['drafts'], additionalProperties: false });
    const item = (schema.properties as { drafts: { items: Record<string, unknown> } }).drafts.items;
    expect(item.required).toEqual(['kind', 'front', 'back', 'explanation', 'sourceQuote', 'options']);
    expect(item.additionalProperties).toBe(false);
    expect((item.properties as { options: unknown }).options).toMatchObject({
      anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
    });
    expect((item.properties as { kind: unknown }).kind).toMatchObject({
      enum: ['basic', 'cloze', 'multiple_choice'],
    });
  });

  it('quita lo que el modo estricto no acepta: zod lo vuelve a validar después', () => {
    const text = JSON.stringify(schema);
    for (const word of ['maxLength', 'minLength', 'minItems', 'maxItems', '$schema']) {
      expect(text).not.toContain(word);
    }
  });
});
