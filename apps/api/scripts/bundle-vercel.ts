// ADR-018: la función de Vercel (servicio `api`) como un solo módulo ESM con sus dependencias JS
// adentro, a partir de dist/ (tsc). El runtime de Vercel no permite require() de un módulo ESM, y
// @nestjs/throttler, nestjs-cls y nestjs-pino (CommonJS) hacen require de Nest 12 (solo ESM):
// empaquetados, esos require se resuelven aquí. Quedan fuera @node-rs/argon2 (binario nativo) y
// los paquetes opcionales sin instalar, que Nest y pg cargan solo si se usan.
import { join } from 'node:path';
import { build, type Plugin } from 'esbuild';

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

await build({
  absWorkingDir: join(import.meta.dirname, '..'),
  entryPoints: ['dist/main.js'],
  outfile: 'vercel-function/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['@node-rs/argon2'],
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
