import { estudioConfig } from '@estudio/config/eslint';

// FRONTEND FE1 y FE5, AGENTS §5 y ARCHITECTURE ARC8, verificados en lint.
const forbidden = {
  group: ['@estudio/api', '@prisma/*', 'openai', 'cloudinary'],
  message: 'La web no importa la api ni SDKs que requieren secretos (AGENTS §5, ARC8).',
};
const deepFeature = {
  group: ['@/features/*/*'],
  message: 'Importa otra feature solo por su index.ts (FRONTEND FE1).',
};
const dexieOutside = {
  group: ['dexie', 'dexie-react-hooks', '@/db', '@/db/*'],
  message: 'Dexie solo en db/, sync/, queries.ts y commands.ts (FRONTEND FE1).',
};
const uiImportsFeature = {
  group: ['@/features', '@/features/*', '../features/*', '../../features/*'],
  message: 'ui/ no importa features (FRONTEND FE1).',
};

export default estudioConfig({
  tsconfigRootDir: import.meta.dirname,
  react: true,
  restrictedImports: [forbidden, deepFeature, dexieOutside],
  restrictedSyntax: [
    {
      selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
      message: 'Lee el entorno solo en src/lib/env.ts (FRONTEND FE5).',
    },
  ],
  overrides: [
    {
      files: [
        'src/db/**',
        'src/sync/**',
        'src/**/queries.ts',
        'src/**/commands.ts',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/test/**',
      ],
      rules: { 'no-restricted-imports': ['error', { patterns: [forbidden, deepFeature] }] },
    },
    {
      files: ['src/ui/**'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [forbidden, dexieOutside, uiImportsFeature] }],
      },
    },
    { files: ['src/lib/env.ts'], rules: { 'no-restricted-syntax': 'off' } },
  ],
});
