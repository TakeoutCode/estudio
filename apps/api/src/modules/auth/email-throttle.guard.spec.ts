import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import { EMAIL_ATTEMPTS } from './constants.js';
import { EmailThrottleGuard } from './email-throttle.guard.js';

const T0 = Date.UTC(2026, 9, 21, 12);

function setup() {
  let now = T0;
  const guard = new EmailThrottleGuard({ now: () => now });
  const headers: Record<string, string> = {};
  const attempt = (body: unknown) =>
    guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ body }),
        getResponse: () => ({
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        }),
      }),
    } as unknown as ExecutionContext);
  return {
    attempt,
    headers,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const blocked = (run: () => unknown) => {
  try {
    run();
    return false;
  } catch (error) {
    return error instanceof DomainError && error.code === 'rate_limited';
  }
};

describe('BE12: segundo límite de login y registro, por correo', () => {
  it('cuenta por correo normalizado, sin importar la IP; el siguiente intento responde 429 con Retry-After', () => {
    const { attempt, headers } = setup();
    for (let i = 0; i < EMAIL_ATTEMPTS.limit; i += 1) {
      expect(attempt({ email: i % 2 === 0 ? 'Ella@Ejemplo.mx ' : 'ella@ejemplo.mx' })).toBe(true);
    }
    expect(blocked(() => attempt({ email: 'ELLA@ejemplo.mx' }))).toBe(true);
    expect(Number(headers['Retry-After'])).toBe(EMAIL_ATTEMPTS.windowMs / 1000);
    // Otro correo no se ve afectado.
    expect(attempt({ email: 'otra@ejemplo.mx' })).toBe(true);
  });

  it('la ventana es deslizante: al pasar, vuelve a dejar intentar', () => {
    const { attempt, advance } = setup();
    for (let i = 0; i < EMAIL_ATTEMPTS.limit; i += 1) attempt({ email: 'ella@ejemplo.mx' });
    advance(EMAIL_ATTEMPTS.windowMs - 1);
    expect(blocked(() => attempt({ email: 'ella@ejemplo.mx' }))).toBe(true);
    advance(2);
    expect(attempt({ email: 'ella@ejemplo.mx' })).toBe(true);
  });

  it('un cuerpo sin correo pasa: lo rechaza la validación (ZodPipe), no este límite', () => {
    const { attempt } = setup();
    expect(attempt(undefined)).toBe(true);
    expect(attempt({ email: 42 })).toBe(true);
  });
});
