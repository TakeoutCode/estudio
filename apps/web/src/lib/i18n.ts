import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import common from '../i18n/es/common.json';

// AGENTS AG5: todo texto visible sale del catálogo `es`; `lint:copy` revisa su tono.

export const defaultNS = 'common';
export const resources = { es: { common } } as const;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['es'];
  }
}

void i18next.use(initReactI18next).init({
  lng: 'es',
  fallbackLng: 'es',
  defaultNS,
  resources,
  interpolation: { escapeValue: false }, // React ya escapa
  returnNull: false,
});

export { i18next };
