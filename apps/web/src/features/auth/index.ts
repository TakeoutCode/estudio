export { AccountMismatchError, accountUserId, bindDeviceToAccount } from './commands';
export { RequireAccount } from './RequireAccount';
export {
  authorizedApi,
  deleteAccount,
  login,
  logout,
  refreshSession,
  register,
  type RefreshOutcome,
  setAuthClientForTests,
} from './session';
export { useAuth } from './store';

/**
 * FE9: la pantalla de login y la sección de borrar la cuenta solo la usa el router; con una exportación estática entraría en el JS inicial,
 * porque el arranque y Hoy importan este index por otras funciones.
 */
export const loadLoginScreen = async () => (await import('./LoginScreen')).LoginScreen;
export const loadDeleteAccountSection = async () =>
  (await import('./DeleteAccountSection')).DeleteAccountSection;
