import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigation } from 'react-router';
import { Loading, useDelayed } from '@/ui/Loading';
import { OfflineBanner } from './OfflineBanner';
import { showsTabs, TabBar } from './TabBar';
import { UpdatePrompt } from './UpdatePrompt';
import { useStoredTheme } from './use-stored-theme';

/** §3 y FE9: fuera del JS inicial; se carga con la primera pantalla ya a la vista. */
const TimerKeepAlive = lazy(async () => ({ default: (await import('@/features/timer')).TimerKeepAlive }));

/** Márgenes y safe areas del layout, también mientras llega la primera pantalla. */
const SHELL =
  'mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-[max(1rem,env(safe-area-inset-left))] pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(var(--chrome-bottom)+var(--edge-bottom))]';

/** UX3: mientras llega la primera pantalla, el esqueleto con los márgenes del layout. */
export function LayoutLoading() {
  return (
    <div className={SHELL}>
      <Loading />
    </div>
  );
}

/**
 * UI-UX UX2: el contenido respeta las safe areas del iPhone y, en las pantallas principales,
 * deja sitio a la barra de pestañas (`data-tabs` ajusta `--chrome-bottom`). UX5: aplica el tema.
 */
export function RootLayout() {
  useStoredTheme();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const tabs = showsTabs(pathname);
  // UX3: si la pantalla siguiente tarda más de 300 ms en llegar (su chunk, sin red), se avisa.
  const slow = useDelayed(useNavigation().state === 'loading');
  return (
    <div data-tabs={tabs ? '' : undefined} className={SHELL}>
      {/* §3: fuera del estudio el temporizador sigue; ahí lo mueve su propia pantalla. */}
      {pathname.startsWith('/study') ? null : (
        <Suspense fallback={null}>
          <TimerKeepAlive />
        </Suspense>
      )}
      {slow ? (
        <div
          role="progressbar"
          aria-label={t('app.loading')}
          className="fixed inset-x-0 top-0 z-50 h-1 bg-primary motion-safe:animate-pulse"
        />
      ) : null}
      <UpdatePrompt />
      <OfflineBanner />
      <main className="flex flex-1 flex-col gap-4">
        <Outlet />
      </main>
      {tabs ? <TabBar /> : null}
    </div>
  );
}
