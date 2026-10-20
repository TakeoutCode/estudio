import './index.css';
import common from './i18n/es/common.json';

// Si algo falla al cargar la app (entorno inválido, chunk que no llega), se muestra un
// aviso en lugar de una pantalla en blanco (UI-UX UX3).
const root = document.getElementById('root');
if (!root) throw new Error('No existe #root en index.html');

import('./boot')
  .then(({ boot }) => {
    boot(root);
  })
  .catch((error: unknown) => {
    console.error(error);
    root.textContent = common.error.boot;
  });
