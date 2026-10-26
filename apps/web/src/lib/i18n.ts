import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import boot from '../i18n/es/boot.json';

// AGENTS AG5: todo texto visible sale del catálogo `es`; `lint:copy` revisa su tono.
//
// FRONTEND FE9: el catálogo va en dos archivos del mismo namespace. `boot.json` trae lo que
// pintan el layout y Hoy, y entra en el JS inicial; `rest.json`, todo lo demás, llega con
// `loadFullCatalog()`, que esperan las demás rutas y que el arranque pide tras el primer render.

export const defaultNS = 'common';
// Una copia: al llegar rest.json, i18next lo fusiona dentro de este objeto.
export const resources = { es: { common: structuredClone(boot) } } as const;

type Rest = typeof import('../i18n/es/rest.json');

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: { common: typeof boot & Rest };
  }
}

void i18next.use(initReactI18next).init({
  lng: 'es',
  fallbackLng: 'es',
  defaultNS,
  resources,
  interpolation: { escapeValue: false }, // React ya escapa
  returnNull: false,
  // Al llegar `rest.json`, lo que ya estaba en pantalla se vuelve a pintar con sus textos.
  react: { bindI18nStore: 'added' },
});

let rest: Promise<void> | undefined;

/** El resto del catálogo (`rest.json`), una sola vez; las rutas que no son Hoy lo esperan. */
export const loadFullCatalog = (): Promise<void> =>
  (rest ??= import('../i18n/es/rest.json').then((module) => {
    // Vite entrega el JSON como módulo: el catálogo completo es su `default`.
    const { default: catalog } = module as unknown as { default: Rest };
    i18next.addResourceBundle('es', defaultNS, catalog, true, false);
  }));

export { i18next };
