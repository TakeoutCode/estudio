import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';
import { reportRouteError } from '@/sync';
import { EmptyState } from '@/ui/EmptyState';

/**
 * UI-UX UX3: qué pasó y qué hacer, sin culpa; los datos siguen en el dispositivo. FE13: dentro
 * del layout ocupa solo la pantalla que falló; `standalone`, la raíz, cuando falló el layout.
 */
export function RouteError({ standalone = false }: { readonly standalone?: boolean }) {
  const { t } = useTranslation();
  const error = useRouteError();
  // FRONTEND FE13: queda en la consola y, ya filtrado, en los diagnósticos que se envían.
  useEffect(() => {
    console.error(error);
    reportRouteError(error, window.location.pathname);
  }, [error]);
  const content = (
    <EmptyState
      message={t('error.generic')}
      action={
        <button
          type="button"
          className="min-h-11 rounded-(--radius-card) bg-primary px-4 font-bold text-primary-contrast candy"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t('error.retry')}
        </button>
      }
    />
  );
  return standalone ? <main className="p-4">{content}</main> : content;
}
