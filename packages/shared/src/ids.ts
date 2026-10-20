import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/** ID de toda entidad sincronizable: UUIDv7 generado en el cliente (AGENTS AG7, ADR-013). */
export const newId = (): string => uuidv7();

/** Nodo del HLC para escrituras hechas por el servidor (SYNC §2). */
export const SERVER_NODE = '00000000-0000-0000-0000-000000000000';

export const SettingsSectionSchema = z.enum(['profile', 'study', 'notifications', 'gamification', 'ui']);
export type SettingsSection = z.infer<typeof SettingsSectionSchema>;

// Espacio de nombres fijo para los IDs deterministas de UserSettings. No cambiar: los
// dispositivos ya sincronizados dependen de él.
const SETTINGS_NAMESPACE = '6f0c2d4e-5a7b-4c1d-9e3f-2b8a7c6d5e4f';

/**
 * Una fila de UserSettings por sección con ID determinista (SYNC §1): dos dispositivos
 * que crean la misma sección sin red escriben la misma fila y LWW la resuelve.
 */
export const settingsRowId = (userId: string, section: SettingsSection): string =>
  uuidv5(`${userId}:${section}`, SETTINGS_NAMESPACE);
