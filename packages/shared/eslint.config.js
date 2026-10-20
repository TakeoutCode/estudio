import { estudioConfig } from '@estudio/config/eslint';

// ARCHITECTURE §2: shared corre en navegador y en Node; solo depende de zod y uuid.
export default estudioConfig({
  tsconfigRootDir: import.meta.dirname,
  restrictedImports: [
    {
      group: ['react', 'react-*', '@nestjs/*', 'dexie', 'dexie-*', '@prisma/*', 'ts-fsrs', 'node:*'],
      message: 'shared no importa frameworks, almacenamiento ni APIs de Node (ARCHITECTURE §2).',
    },
  ],
});
