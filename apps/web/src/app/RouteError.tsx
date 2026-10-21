import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { reportRouteError } from '@/sync';
import { EmptyState } from '@/ui/EmptyState';

/** UI-UX UX3: qué pasó y qué hacer, sin culpa; los datos siguen en el dispositivo. */
export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  // FRONTEND FE13: queda en la consola y, ya filtrado, en los diagnósticos que se envían.
  useEffect(() => {
    console.error(error);
    reportRouteError(error, window.location.pathname);
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
