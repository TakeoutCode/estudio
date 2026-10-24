import { Outlet, useLocation } from 'react-router';
import { OfflineBanner } from './OfflineBanner';
import { showsTabs, TabBar } from './TabBar';
import { UpdatePrompt } from './UpdatePrompt';
import { useStoredTheme } from './use-stored-theme';

/**
 * UI-UX UX2: el contenido respeta las safe areas del iPhone y, en las pantallas principales,
 * deja sitio a la barra de pestañas (`data-tabs` ajusta `--chrome-bottom`). UX5: aplica el tema.
 */
export function RootLayout() {
  useStoredTheme();
  const tabs = showsTabs(useLocation().pathname);
  return (
    <div
      data-tabs={tabs ? '' : undefined}
      className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-[max(1rem,env(safe-area-inset-left))] pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(var(--chrome-bottom)+var(--edge-bottom))]"
    >
      <UpdatePrompt />
      <OfflineBanner />
      <main className="flex flex-1 flex-col gap-4">
        <Outlet />
      </main>
      {tabs ? <TabBar /> : null}
    </div>
  );
}
