/** Una cuenta por proyecto (BE10: registro solo con correo permitido), para que no se crucen. */
export const accountFor = (project: string): string => `e2e-${project}@ejemplo.mx`;
export const E2E_PASSWORD = 'una-contraseña-larga-de-e2e';
export const E2E_PROJECTS = ['iphone', 'desktop'] as const;
