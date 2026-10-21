import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import { EMAIL_ATTEMPTS } from './constants.js';

/**
 * BE12: cuenta los intentos por correo (normalizado como en ALLOWED_EMAILS) en una ventana
 * deslizante. Corre antes del ZodPipe: un cuerpo sin correo lo rechaza la validación, no esto.
 */
@Injectable()
export class EmailThrottleGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const body: unknown = http.getRequest<Request>().body;
    const raw = body !== null && typeof body === 'object' && 'email' in body ? body.email : null;
    if (typeof raw !== 'string') return true;
    const email = raw.trim().toLowerCase();
    const now = this.clock.now();
    const recent = (this.attempts.get(email) ?? []).filter((at) => at > now - EMAIL_ATTEMPTS.windowMs);
    if (recent.length >= EMAIL_ATTEMPTS.limit) {
      const oldest = recent[0] ?? now;
      const waitSec = Math.ceil((oldest + EMAIL_ATTEMPTS.windowMs - now) / 1000);
      http.getResponse<Response>().setHeader('Retry-After', String(Math.max(1, waitSec)));
      this.attempts.set(email, recent);
      throw new DomainError('rate_limited');
    }
    recent.push(now);
    this.attempts.set(email, recent);
    this.forgetOld(now);
    return true;
  }

  /** Sin esto, correos que ya no intentan quedarían en memoria para siempre. */
  private forgetOld(now: number): void {
    for (const [email, times] of this.attempts) {
      if ((times.at(-1) ?? 0) <= now - EMAIL_ATTEMPTS.windowMs) this.attempts.delete(email);
    }
  }
}
