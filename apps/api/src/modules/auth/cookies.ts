import type { CookieOptions } from 'express';
import { REFRESH_COOKIE_PATH } from './constants.js';

/** Lee una cookie del encabezado sin depender de cookie-parser. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * BE10: HttpOnly, SameSite=Lax y Path=/auth, sin Domain (solo `api.<dominio>`). Secure en
 * producción; en desarrollo la API corre en http://localhost.
 */
export const refreshCookieOptions = (secure: boolean, expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: REFRESH_COOKIE_PATH,
  ...(expires ? { expires } : {}),
});
