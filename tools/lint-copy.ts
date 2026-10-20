// UI-UX UX8: revisa el tono de todos los catálogos `es` (web y api). Falla si encuentra
// lenguaje de culpa, atraso, ranking o ritmos "óptimos" (R17, R19, R20, §5).
// Uso: pnpm lint:copy
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

interface Rule {
  readonly pattern: RegExp;
  readonly reason: string;
}

// Se comparan sin acentos y en minúsculas: escribe los patrones así.
const RULES: readonly Rule[] = [
  { pattern: /atrasad/, reason: '§5: se dice "pendientes"' },
  { pattern: /vencid/, reason: '§5: se dice "pendientes"' },
  { pattern: /optim/, reason: 'R17: ningún ritmo es óptimo' },
  { pattern: /cientificamente/, reason: 'R17, R20' },
  { pattern: /racha (perdida|rota|en riesgo)/, reason: 'R19: la racha se pausa, no se pierde' },
  { pattern: /perdiste/, reason: 'R19: sin lenguaje de pérdida' },
  { pattern: /fallaste/, reason: 'R19: fallar es esperable' },
  { pattern: /no rompas/, reason: 'R19' },
  { pattern: /ranking|clasificacion/, reason: 'R19: nunca comparar con otras personas' },
  { pattern: /deberias/, reason: 'UX7: sin juicios' },
  { pattern: /solo te quedan/, reason: 'UX10: sin urgencia' },
  { pattern: /te quedas atras/, reason: 'R19' },
  { pattern: /olvidas? (el )?\d+ ?%/, reason: 'R20: cifra de olvido sin fuente' },
];

interface Allowed {
  readonly file: string;
  readonly key: string;
  readonly reason: string;
}

const ROOT = join(import.meta.dirname, '..');
const ALLOW_FILE = join(ROOT, 'tools', 'lint-copy.allow.json');

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function* catalogs(): Generator<string> {
  for (const app of readdirSync(join(ROOT, 'apps'))) {
    const dir = join(ROOT, 'apps', app, 'src', 'i18n', 'es');
    if (existsSync(dir)) yield* jsonFiles(dir);
  }
}

function* jsonFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(path);
    else if (entry.name.endsWith('.json')) yield path;
  }
}

function* strings(value: unknown, key: string): Generator<[string, string]> {
  if (typeof value === 'string') yield [key, value];
  else if (value && typeof value === 'object') {
    for (const [child, nested] of Object.entries(value))
      yield* strings(nested, key ? `${key}.${child}` : child);
  }
}

const allowed: readonly Allowed[] = existsSync(ALLOW_FILE)
  ? (JSON.parse(readFileSync(ALLOW_FILE, 'utf8')) as { entries: Allowed[] }).entries
  : [];

const problems: string[] = [];
let checked = 0;

for (const file of catalogs()) {
  const rel = relative(ROOT, file).split(sep).join('/');
  for (const [key, text] of strings(JSON.parse(readFileSync(file, 'utf8')), '')) {
    checked += 1;
    if (allowed.some((a) => a.file === rel && a.key === key)) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(normalize(text))) problems.push(`${rel} › ${key}: "${text}" (${rule.reason})`);
    }
  }
}

if (problems.length > 0) {
  console.error(`lint:copy encontró ${problems.length} texto(s) que no cumplen UI-UX UX8:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(`lint:copy: ${checked} textos revisados, sin problemas.`);
