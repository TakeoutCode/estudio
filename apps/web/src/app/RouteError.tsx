import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/ui/EmptyState';

/** UI-UX UX3: qué pasó y qué hacer, sin culpa; los datos siguen en el dispositivo. */
export function RouteError() {
  const { t } = useTranslation();
  return (
    <main className="p-4">
      <EmptyState
        message={t('error.generic')}
        action={
          <button
            type="button"
            className="min-h-11 rounded-(--radius-card) bg-primary px-4 text-primary-contrast"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('error.retry')}
          </button>
        }
      />
    </main>
  );
}
