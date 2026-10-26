export {
  answerFewerNewProposal,
  ensureProfileTimeZone,
  updateGamificationConfig,
  updateNotificationPrefs,
  updateProfile,
  updateStudyConfig,
  updateUiSettings,
} from './commands';
export { useNotificationPrefs, useUiSettings } from './queries';

/**
 * FE9: la pantalla de Ajustes solo la usa el router; con una exportación estática entraría en el JS inicial,
 * porque el arranque y Hoy importan este index por otras funciones.
 */
export const loadSettingsScreen = async () => {
  const [{ SettingsScreen }, { SyncSection }] = await Promise.all([
    import('./SettingsScreen'),
    import('./SyncSection'),
  ]);
  return { SettingsScreen, SyncSection };
};
