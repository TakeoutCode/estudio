import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../common/clock.js';
import type { AppConfig } from '../../config/app-config.js';
import type { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { hashPassword } from './password.js';
import type { TokenService } from './token.service.js';

vi.mock('./password.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./password.js')>();
  return { ...original, hashPassword: vi.fn(() => Promise.resolve('hash')) };
});

const ALLOWED = 'ella@example.com';

function setup({ existing }: { existing: boolean }) {
  const createUser = vi.fn(() => Promise.resolve());
  const repo = {
    findUserByEmail: () => Promise.resolve(existing ? { id: 'u', passwordHash: 'h' } : null),
    createUser,
  } as unknown as AuthRepository;
  const config = { get: () => [ALLOWED] } as unknown as AppConfig;
  const clock: Clock = { now: () => 0 };
  return { service: new AuthService(repo, {} as TokenService, config, clock), createUser };
}

describe('BE10: el registro tarda lo mismo en todos los casos', () => {
  it.each([
    { caso: 'correo no permitido', email: 'otra@example.com', existing: false, creates: false },
    { caso: 'cuenta ya existente', email: ALLOWED, existing: true, creates: false },
    { caso: 'cuenta nueva', email: ALLOWED, existing: false, creates: true },
  ])('$caso: calcula el hash de argon2', async ({ email, existing, creates }) => {
    vi.mocked(hashPassword).mockClear();
    const { service, createUser } = setup({ existing });
    await service.register({ email, password: 'una contraseña larga' });
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledTimes(creates ? 1 : 0);
  });
});
