import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

/** Si el navegador cree tener red (UI-UX UX3: sin conexión no es un error). */
export const useOnline = (): boolean => useSyncExternalStore(subscribe, () => navigator.onLine);
