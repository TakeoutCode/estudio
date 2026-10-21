import './lib/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { accountUserId, refreshSession } from './features/auth';
import { applyTheme } from './lib/theme';
import { captureClientErrors, startSync } from './sync';

export function boot(root: HTMLElement): void {
  // FRONTEND FE13: desde el arranque, los errores sin atrapar quedan para los diagnósticos.
  captureClientErrors();
  // UI-UX UX5: Sistema hasta leer UserSettings.ui; RootLayout aplica lo guardado.
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
