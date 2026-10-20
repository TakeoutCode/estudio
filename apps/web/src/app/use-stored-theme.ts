import { useEffect } from 'react';
import { useUiSettings } from '@/features/settings';
import { applyTheme } from '@/lib/theme';

/**
 * UI-UX UX5: aplica el tema guardado en UserSettings.ui. Mientras se lee, queda el de
 * arranque (Sistema); luego sigue a lo guardado aquí o lo que llegue por sync.
 */
export function useStoredTheme(): void {
  const theme = useUiSettings()?.theme;
  useEffect(() => (theme ? applyTheme(theme) : undefined), [theme]);
}
