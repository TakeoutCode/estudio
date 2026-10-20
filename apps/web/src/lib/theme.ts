export type ThemePreference = 'system' | 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * UI-UX UX5: Sistema (por defecto), Claro u Oscuro. Devuelve una función para dejar de
 * seguir los cambios del sistema.
 */
export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): () => void {
  if (preference !== 'system') {
    root.dataset.theme = preference;
    return () => undefined;
  }
  const media = window.matchMedia(DARK_QUERY);
  const sync = () => {
    root.dataset.theme = media.matches ? 'dark' : 'light';
  };
  sync();
  media.addEventListener('change', sync);
  return () => {
    media.removeEventListener('change', sync);
  };
}
