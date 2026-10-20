import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { EmptyState } from '@/ui/EmptyState';

/** UI-UX UX3: qué pasó y qué hacer, sin culpa; los datos siguen en el dispositivo. */
export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  // Hasta que exista el registro de diagnósticos (FRONTEND FE13), al menos queda en la consola.
  useEffect(() => {
    console.error(error);
  }, [error]);
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
