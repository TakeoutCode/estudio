import { estudioConfig } from '@estudio/config/eslint';

// ARCHITECTURE §2 y BACKEND BE4: la api no importa la web ni Dexie, y lee el entorno solo
// en src/config.
export default estudioConfig({
  tsconfigRootDir: import.meta.dirname,
  node: true,
  restrictedImports: [
    {
      group: ['@estudio/web', 'dexie', 'dexie-*', 'react', 'react-*'],
      message: 'La api no importa la web ni almacenamiento del cliente (ARCHITECTURE §2).',
    },
  ],
  restrictedProperties: [
    { object: 'process', property: 'env', message: 'Lee el entorno solo con AppConfig (BACKEND BE4).' },
  ],
  overrides: [
    {
      // src/test/ fija el entorno antes de importar ConfigModule (pruebas de integración).
      files: ['src/config/**', 'src/test/**', '*.config.ts'],
      rules: { 'no-restricted-properties': 'off' },
    },
    {
      rules: {
        // Los módulos de Nest son clases vacías con decorador.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
  ],
});
