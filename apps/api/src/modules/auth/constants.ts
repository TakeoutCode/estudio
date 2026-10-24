// BACKEND BE10. Parámetros de seguridad, no umbrales de estudio.
import { API_PREFIX } from '../../common/api-prefix.js';

/** Vida del access JWT. Solo vive en memoria del cliente. */
export const ACCESS_TTL_MS = 15 * 60 * 1000;
/** Vida del refresh; se renueva en cada rotación. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Dos pestañas pueden refrescar a la vez con el mismo token. Dentro de esta ventana el
 * reuso responde 409 (reintentar con la cookie nueva) en vez de revocar la sesión.
 */
export const REFRESH_REUSE_GRACE_MS = 10 * 1000;

export const JWT_ISSUER = 'estudio-api';
export const JWT_AUDIENCE = 'estudio-web';

/** Path=/api/auth: la cookie solo viaja a los endpoints de auth (ADR-019). */
export const REFRESH_COOKIE = 'estudio_rt';
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

/**
 * BE12: límites de login y registro, por IP y, además, por correo, para que repartir intentos
 * entre muchas IP no sirva. Viven en Postgres (`auth_attempt`) porque la API corre en varias
 * instancias de función que no comparten memoria (ADR-018). Un intento bloqueado no cuenta.
 */
export const AUTH_ATTEMPTS = {
  ip: { limit: 5, windowMs: 60 * 1000 },
  email: { limit: 10, windowMs: 15 * 60 * 1000 },
} as const;
