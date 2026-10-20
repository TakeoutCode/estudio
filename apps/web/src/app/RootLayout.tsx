import { Outlet } from 'react-router';
import { OfflineBanner } from './OfflineBanner';
import { UpdatePrompt } from './UpdatePrompt';
import { useStoredTheme } from './use-stored-theme';

/** UI-UX UX2: el contenido respeta las safe areas del iPhone. UX5: aplica el tema elegido. */
export function RootLayout() {
  useStoredTheme();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-[max(1rem,env(safe-area-inset-left))] pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <UpdatePrompt />
      <OfflineBanner />
      <main className="flex flex-1 flex-col gap-4">
        <Outlet />
      </main>
    </div>
  );
}
