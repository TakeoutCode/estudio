// BACKEND BE10. Parámetros de seguridad, no umbrales de estudio.

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

/** Path=/auth: la cookie solo viaja a los endpoints de auth. */
export const REFRESH_COOKIE = 'estudio_rt';
export const REFRESH_COOKIE_PATH = '/auth';

/**
 * BE12: segundo límite de login y registro, por correo y no por IP, para que repartir intentos
 * entre muchas IP no sirva. Como el de IP, vive en memoria y se reinicia con cada deploy.
 */
export const EMAIL_ATTEMPTS = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
