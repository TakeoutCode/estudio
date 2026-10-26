export { retryOpenedWhenOnline } from './commands';
export { NotificationsAtOpen } from './NotificationsAtOpen';
export { useBreakEndNotice } from './use-break-end-notice';

/**
 * FE9: la sección de avisos de Ajustes solo la usa el router; con una exportación estática entraría en el JS inicial,
 * porque el arranque y Hoy importan este index por otras funciones.
 */
export const loadNotificationsSection = async () =>
  (await import('./NotificationsSection')).NotificationsSection;
