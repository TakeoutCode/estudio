/** Una cuenta por proyecto (BE10: registro solo con correo permitido), para que no se crucen. */
export const accountFor = (project: string): string => `e2e-${project}@ejemplo.mx`;
export const E2E_PASSWORD = 'una-contraseña-larga-de-e2e';
export const E2E_PROJECTS = ['iphone', 'desktop'] as const;
/** La API de las pruebas; puerto propio para no chocar con `pnpm dev` (3180). */
export const E2E_API = 'http://localhost:3190';
