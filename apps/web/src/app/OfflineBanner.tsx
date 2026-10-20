import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner } from '@/ui/Banner';

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

export const useOnline = (): boolean => useSyncExternalStore(subscribe, () => navigator.onLine);

/** UI-UX UX3: sin conexión no es un error; lo respondido queda en Dexie (R3). */
export function OfflineBanner() {
  const { t } = useTranslation();
  return useOnline() ? null : <Banner>{t('offline.banner')}</Banner>;
}
