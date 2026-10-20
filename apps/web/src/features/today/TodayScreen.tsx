import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/ui/EmptyState';

/** Pantalla inicial. La cola de repasos llega con la feature `study` (buildSessionQueue). */
export function TodayScreen() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="m-0 text-title font-semibold">{t('today.title')}</h1>
      <EmptyState message={t('today.empty')} />
    </>
  );
}
