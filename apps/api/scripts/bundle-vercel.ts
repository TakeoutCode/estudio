// ADR-018: la función de Vercel (servicio `api`) como un solo módulo ESM con sus dependencias JS
// adentro, a partir de dist/ (tsc). El runtime de Vercel no permite require() de un módulo ESM, y
// @nestjs/throttler, nestjs-cls y nestjs-pino (CommonJS) hacen require de Nest 12 (solo ESM):
// empaquetados, esos require se resuelven aquí. Quedan fuera @node-rs/argon2 (binario nativo),
// que se copia junto al bundle, y los paquetes opcionales sin instalar, que Nest y pg cargan solo
// si se usan.
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build, type Plugin } from 'esbuild';

const API_ROOT = join(import.meta.dirname, '..');
const OUT_DIR = join(API_ROOT, 'vercel-function');
const ARGON2 = '@node-rs/argon2';
const OPTIONAL = 'optional-packages';

/** Un paquete que no se resuelve es opcional y no está instalado: queda como import externo. */
const optionalPackages: Plugin = {
  name: OPTIONAL,
  setup(bundle) {
    bundle.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData === OPTIONAL) return undefined;
      const resolved = await bundle.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: OPTIONAL,
      });
      return resolved.errors.length > 0 ? { path: args.path, external: true } : undefined;
    });
  },
};

rmSync(OUT_DIR, { recursive: true, force: true });
await build({
  absWorkingDir: API_ROOT,
  entryPoints: ['dist/main.js'],
  outfile: join(OUT_DIR, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: [ARGON2],
  plugins: [optionalPackages],
  // Los módulos CommonJS empaquetados usan require, __dirname y __filename, que en ESM no existen.
  banner: {
    js: [
      "import { createRequire as createBundleRequire } from 'node:module';",
      'const require = createBundleRequire(import.meta.url);',
    ].join('\n'),
  },
  define: { __dirname: 'import.meta.dirname', __filename: 'import.meta.filename' },
  logLevel: 'warning',
});

// argon2 y el binario de la plataforma del build, en vercel-function/node_modules: Vercel copia la
// carpeta completa a la función y main.mjs los encuentra sin depender del layout de pnpm.
const argon2Dir = dirname(createRequire(join(API_ROOT, 'package.json')).resolve(`${ARGON2}/package.json`));
const fromArgon2 = createRequire(join(argon2Dir, 'package.json'));
const { optionalDependencies = {} } = JSON.parse(readFileSync(join(argon2Dir, 'package.json'), 'utf8')) as {
  optionalDependencies?: Record<string, string>;
};
const bindings = Object.keys(optionalDependencies).flatMap((name) => {
  try {
    return [{ name, dir: dirname(fromArgon2.resolve(`${name}/package.json`)) }];
  } catch {
    return [];
  }
});
if (bindings.length === 0) throw new Error(`${ARGON2}: no hay binario instalado para esta plataforma`);
for (const { name, dir } of [{ name: ARGON2, dir: argon2Dir }, ...bindings]) {
  cpSync(dir, join(OUT_DIR, 'node_modules', name), { recursive: true, dereference: true });
}
