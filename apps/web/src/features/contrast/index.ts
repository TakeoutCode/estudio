export { createContrastGroup, deleteContrastGroup, updateContrastGroup } from './commands';
export { readContrastPlan, useContrastNames } from './queries';

/**
 * FE9: las pantallas de tarjetas que se confunden solo la usa el router; con una exportación estática entraría en el JS inicial,
 * porque el arranque y Hoy importan este index por otras funciones.
 */
export const loadContrastScreen = async () => (await import('./ContrastScreen')).ContrastScreen;
export const loadContrastEditorScreen = async () =>
  (await import('./ContrastEditorScreen')).ContrastEditorScreen;
