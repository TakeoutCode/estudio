import './lib/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { accountUserId, refreshSession } from './features/auth';
import { applyTheme } from './lib/theme';
import { startSync } from './sync';

export function boot(root: HTMLElement): void {
  // UI-UX UX5: la preferencia viene de UserSettings.ui cuando exista; por ahora, Sistema.
  applyTheme('system');
  // Si este dispositivo ya tiene cuenta y la cookie sigue vigente, la sesión vuelve sin
  // pedir la contraseña. Sin cuenta, la pantalla de login lo resuelve.
  void accountUserId().then((userId) => (userId ? refreshSession() : undefined));
  startSync();
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
