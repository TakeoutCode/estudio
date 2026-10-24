/**
 * ADR-019: la API vive bajo `/api`, en el mismo origen que la web. Vercel la enruta por ese
 * prefijo sin quitarlo, así que Nest lo usa también en local y en las pruebas.
 */
export const API_PREFIX = 'api';
