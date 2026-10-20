// Configuración ESLint compartida. Las restricciones de importación implementan los
// límites de AGENTS.md (AG3, AG5) y ARCHITECTURE.md (ARC1); fallar aquí es intencional.
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', 'test/**/*.ts'];

/** Prohibidos en cualquier prueba: `.todo` también es una prueba saltada (AGENTS §5). */
const TEST_RESTRICTED_PROPERTIES = [
  { object: 'it', property: 'todo', message: 'Las pruebas pendientes no se suben (AGENTS §5).' },
  { object: 'test', property: 'todo', message: 'Las pruebas pendientes no se suben (AGENTS §5).' },
  { object: 'describe', property: 'todo', message: 'Las pruebas pendientes no se suben (AGENTS §5).' },
];

/** AG3: `srs` es puro; `now` y la aleatoriedad entran como parámetros. */
export const PURE_RESTRICTED_PROPERTIES = [
  { object: 'Date', property: 'now', message: 'srs es puro: recibe `now` como parámetro (AGENTS AG3).' },
  { object: 'Math', property: 'random', message: 'srs es puro: sin azar propio (AGENTS AG3).' },
];
export const PURE_RESTRICTED_SYNTAX = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'srs es puro: `new Date()` sin argumentos lee el reloj (AGENTS AG3).',
  },
];

/**
 * @param {object} options
 * @param {string} options.tsconfigRootDir directorio del paquete (import.meta.dirname)
 * @param {boolean} [options.react] activa reglas de hooks y globals del navegador
 * @param {boolean} [options.node] activa globals de Node
 * @param {Array<object>} [options.restrictedImports] patrones de `no-restricted-imports`
 * @param {Array<object>} [options.restrictedProperties] entradas de `no-restricted-properties`
 * @param {Array<object>} [options.restrictedSyntax] entradas de `no-restricted-syntax`
 * @param {Array<object>} [options.overrides] bloques de configuración extra al final
 */
export function estudioConfig({
  tsconfigRootDir,
  react = false,
  node = false,
  restrictedImports = [],
  restrictedProperties = [],
  restrictedSyntax = [],
  overrides = [],
}) {
  return defineConfig(
    { ignores: ['dist/**', 'dev-dist/**', 'coverage/**', 'src/generated/**', 'eslint.config.js'] },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
        globals: { ...(react ? globals.browser : {}), ...(node ? globals.node : {}) },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/consistent-type-definitions': 'off',
        'no-restricted-imports': ['error', { patterns: restrictedImports }],
        'no-restricted-properties': ['error', ...restrictedProperties],
        'no-restricted-syntax': ['error', ...restrictedSyntax],
      },
    },
    react ? reactHooks.configs.flat.recommended : {},
    {
      files: TEST_FILES,
      plugins: { vitest },
      rules: {
        ...vitest.configs.recommended.rules,
        'vitest/no-disabled-tests': 'error',
        'vitest/no-focused-tests': 'error',
        // supertest: `request(app).get(...).expect(200)` también es una aserción.
        'vitest/expect-expect': [
          'error',
          { assertFunctionNames: ['expect', 'request.**.expect', 'server.**.expect'] },
        ],
        'no-restricted-properties': ['error', ...restrictedProperties, ...TEST_RESTRICTED_PROPERTIES],
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    ...overrides,
  );
}
