import { z } from 'zod';

// Contratos de auth (BACKEND BE10). El access token vive solo en memoria del cliente; el
// refresh va en cookie HttpOnly y nunca toca el JS de la web.

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** OWASP ASVS: mínimo 12, sin reglas de composición; el máximo protege a argon2. */
export const PasswordSchema = z.string().min(12).max(256);

export const CredentialsSchema = z.object({ email: EmailSchema, password: PasswordSchema }).strict();
export type Credentials = z.infer<typeof CredentialsSchema>;

/**
 * `DELETE /me` (QUALITY QA6): borra la cuenta y todo lo suyo. Pide la contraseña otra vez, así
 * un access token robado no basta para borrarlo todo.
 */
export const DeleteAccountRequestSchema = z.object({ password: z.string().min(1).max(256) }).strict();
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;

export const SessionResponseSchema = z.object({
  userId: z.uuid(),
  accessToken: z.string().min(1),
  /** Vencimiento del access token, epoch ms. */
  expiresAt: z.number().int().positive(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
