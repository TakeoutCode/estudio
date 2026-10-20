import { estudioConfig, PURE_RESTRICTED_PROPERTIES, PURE_RESTRICTED_SYNTAX } from '@estudio/config/eslint';

// AGENTS AG3 y ARCHITECTURE §2: srs es puro. Sin reloj, azar, almacenamiento ni frameworks.
export default estudioConfig({
  tsconfigRootDir: import.meta.dirname,
  restrictedImports: [
    {
      group: ['react', 'react-*', '@nestjs/*', 'dexie', 'dexie-*', '@prisma/*', 'node:*'],
      message: 'srs es puro: sin frameworks, almacenamiento ni APIs de Node (AGENTS AG3).',
    },
  ],
  restrictedProperties: PURE_RESTRICTED_PROPERTIES,
  restrictedSyntax: PURE_RESTRICTED_SYNTAX,
});
