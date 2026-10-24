import { createHash } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../common/domain-error.js';
import { type AttemptKey, AuthService } from './auth.service.js';
import { AUTH_ATTEMPTS } from './constants.js';

/** Solo el SHA-256 llega a la base: ni la IP ni el correo quedan en claro. */
const attemptKey = (
  raw: string,
  limit: { readonly limit: number; readonly windowMs: number },
): AttemptKey => ({
  hash: createHash('sha256').update(raw).digest('hex'),
  ...limit,
});

/** El correo normalizado como en ALLOWED_EMAILS, o `null` si el cuerpo no trae uno. */
function emailOf(body: unknown): string | null {
  const raw = body !== null && typeof body === 'object' && 'email' in body ? body.email : null;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : null;
}

/**
 * BE12: límites de login y registro por IP y por correo, en ventana deslizante. Corre antes del
 * ZodPipe: un cuerpo sin correo cuenta solo por IP y lo rechaza la validación.
 */
@Injectable()
export class AuthAttemptsGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const keys = [attemptKey(`ip:${req.ip ?? ''}`, AUTH_ATTEMPTS.ip)];
    const email = emailOf(req.body);
    if (email !== null) keys.push(attemptKey(`email:${email}`, AUTH_ATTEMPTS.email));
    const waitMs = await this.auth.attempt(keys);
    if (waitMs <= 0) return true;
    http.getResponse<Response>().setHeader('Retry-After', String(Math.max(1, Math.ceil(waitMs / 1000))));
    throw new DomainError('rate_limited');
  }
}
