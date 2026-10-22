import 'fake-indexeddb/auto';
import '@/lib/i18n';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// `findBy*` y `waitFor` esperan 1 s por defecto; con la cobertura activa o la máquina cargada
// (CI, la suite completa) una pantalla con varias lecturas de Dexie tarda más y la prueba
// fallaba sin que nada estuviera mal. Solo cambia cuánto se espera, no lo que se verifica.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
});
