import { z } from 'zod';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Palabras de JSON Schema que la salida estructurada estricta acepta. Lo demás (largos, rangos,
 * patrones) se quita: el modelo no las necesita para la forma y la respuesta se vuelve a validar
 * con zod, que sí las aplica (LEARNING-DESIGN LD15).
 */
const KEEP = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'anyOf',
  'description',
  'additionalProperties',
  '$defs',
  '$ref',
]);

function clean(node: Json): Json {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    // `properties` y `$defs` son mapas de nombres: sus claves no son palabras del esquema.
    out[key] =
      (key === 'properties' || key === '$defs') &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, clean(child)]))
        : clean(value);
  }
  if (
    out.type === 'object' &&
    out.properties &&
    typeof out.properties === 'object' &&
    !Array.isArray(out.properties)
  ) {
    // LD15: en modo estricto todos los campos van en `required` (los opcionales, como nullable).
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

/** LD15: el esquema zod de `shared`, convertido a `json_schema` estricto para el modelo. */
export function strictJsonSchema(schema: z.ZodType): Record<string, Json> {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as Json;
  const cleaned = clean(raw);
  if (cleaned === null || typeof cleaned !== 'object' || Array.isArray(cleaned))
    throw new Error('schema_not_object');
  return cleaned;
}
