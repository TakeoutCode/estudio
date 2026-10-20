import { useTranslation } from 'react-i18next';
import { useOnline } from '@/lib/use-online';
import { Banner } from '@/ui/Banner';

/** UI-UX UX3: sin conexión no es un error; lo respondido queda en Dexie (R3). */
export function OfflineBanner() {
  const { t } = useTranslation();
  return useOnline() ? null : <Banner>{t('offline.banner')}</Banner>;
}
