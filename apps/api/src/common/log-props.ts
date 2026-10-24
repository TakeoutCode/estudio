import type { IncomingMessage } from 'node:http';

/**
 * BACKEND BE6: cada línea de log de una petición con sesión lleva su `userId`, nada más de ella.
 * pino-http la llama al empezar (aún sin sesión) y al terminar, cuando el guard ya la verificó.
 */
export function requestLogProps(req: IncomingMessage): { readonly userId?: string } {
  const user = (req as IncomingMessage & { user?: { id?: unknown } }).user;
  return typeof user?.id === 'string' ? { userId: user.id } : {};
}
