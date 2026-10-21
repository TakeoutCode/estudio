// FRONTEND FE9 y QUALITY QA4: el JS que se descarga antes de ver Hoy, en gzip. Es la entrada,
// el arranque (`boot`) y la ruta inicial, con todo lo que importan sin `import()`; se saca del
// manifiesto de Vite (`vite build --manifest`) porque los nombres de los chunks llevan hash.
//
// FE9 pide 170 kB. Hoy mide unos 269 kB: el límite está justo arriba para que no crezca
// mientras esa deuda se paga (ver FRONTEND FE9).
import { readFileSync } from 'node:fs';

type Manifest = Record<string, { readonly file: string; readonly imports?: readonly string[] }>;

const manifest = JSON.parse(
  readFileSync(new URL('./dist/.vite/manifest.json', import.meta.url), 'utf8'),
) as Manifest;

/** La entrada `key` y todo lo que importa de forma estática. */
function closure(key: string, seen = new Set<string>()): Set<string> {
  const chunk = manifest[key];
  if (!chunk || seen.has(key)) return seen;
  seen.add(key);
  for (const dep of chunk.imports ?? []) closure(dep, seen);
  return seen;
}

function required(key: string): string {
  if (!manifest[key]) throw new Error(`size-limit: falta ${key} en el manifiesto de Vite`);
  return key;
}

const initial = new Set([
  ...closure(required('index.html')),
  ...closure(required('src/boot.tsx')),
  ...closure(required('src/features/today/index.ts')),
]);

export default [
  {
    name: 'JS inicial hasta Hoy (FE9)',
    path: [...initial].map((key) => `dist/${manifest[key]?.file ?? key}`),
    gzip: true,
    limit: '270 kB',
  },
];
