import { type ApiErrorCode, type Credentials, newId } from '@estudio/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import { AppConfig } from '../../config/app-config.js';
import { AuthRepository } from './auth.repository.js';
import { AUTH_ATTEMPTS, REFRESH_REUSE_GRACE_MS, REFRESH_TTL_MS } from './constants.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { hashRefreshToken, TokenService } from './token.service.js';

export interface IssuedSession {
  readonly userId: string;
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
}

type RotateOutcome =
  | { readonly ok: true; readonly session: IssuedSession }
  | { readonly ok: false; readonly code: ApiErrorCode };

/** Una clave de BE12 (hash de la IP o del correo) con su límite. */
export interface AttemptKey {
  readonly hash: string;
  readonly limit: number;
  readonly windowMs: number;
}

const ATTEMPT_RETENTION_MS = Math.max(AUTH_ATTEMPTS.ip.windowMs, AUTH_ATTEMPTS.email.windowMs);

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  /** BE10, ADR-007: solo correos permitidos, y la misma respuesta en todos los casos. */
  async register({ email, password }: Credentials): Promise<void> {
    if (!this.config.get('ALLOWED_EMAILS').includes(email)) return;
    if (await this.repo.findUserByEmail(email)) return;
    await this.repo.createUser({ id: newId(), email, passwordHash: await hashPassword(password) });
  }

  async login({ email, password }: Credentials): Promise<IssuedSession> {
    const user = await this.repo.findUserByEmail(email);
    const valid = await verifyPassword(user?.passwordHash ?? (await dummyHash()), password);
    if (!user || !valid) throw new DomainError('unauthorized');
    return this.startFamily(user.id);
  }

  async refresh(rawToken: string | undefined): Promise<IssuedSession> {
    if (!rawToken) throw new DomainError('unauthorized');
    // La revocación por reuso tiene que confirmarse: el error se lanza después del commit.
    const outcome = await this.rotate(hashRefreshToken(rawToken));
    if (!outcome.ok) throw new DomainError(outcome.code);
    return outcome.session;
  }

  /** Rota el refresh. Reusar uno ya rotado (fuera de la gracia) revoca toda la familia. */
  @Transactional()
  async rotate(tokenHash: string): Promise<RotateOutcome> {
    const now = this.clock.now();
    const token = await this.repo.findRefreshForUpdate(tokenHash);
    if (!token || token.revokedAt || token.expiresAt.getTime() <= now)
      return { ok: false, code: 'unauthorized' };
    if (token.rotatedAt) {
      if (now - token.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS) return { ok: false, code: 'conflict' };
      await this.repo.revokeFamily(token.familyId, new Date(now));
      return { ok: false, code: 'unauthorized' };
    }
    await this.repo.markRotated(token.id, new Date(now));
    return { ok: true, session: await this.issue(token.userId, token.familyId) };
  }

  /**
   * BE12: registra un intento de login o registro si ninguna de sus claves llegó a su límite.
   * Si alguna llegó, no lo registra y devuelve cuánto falta (ms) para que pueda reintentar.
   */
  @Transactional()
  async attempt(keys: readonly AttemptKey[]): Promise<number> {
    const now = this.clock.now();
    await this.repo.lockAttemptKeys(keys.map((key) => key.hash));
    await this.repo.pruneAttempts(new Date(now - ATTEMPT_RETENTION_MS));
    let waitMs = 0;
    for (const key of keys) {
      const recent = await this.repo.recentAttempts(key.hash, new Date(now - key.windowMs));
      if (recent.count >= key.limit) waitMs = Math.max(waitMs, (recent.oldest ?? now) + key.windowMs - now);
    }
    if (waitMs > 0) return waitMs;
    await this.repo.insertAttempts(
      keys.map((key) => key.hash),
      new Date(now),
    );
    return 0;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const token = await this.repo.findRefresh(hashRefreshToken(rawToken));
    if (token) await this.repo.revokeFamily(token.familyId, new Date(this.clock.now()));
  }

  private startFamily(userId: string): Promise<IssuedSession> {
    return this.issue(userId, newId());
  }

  private async issue(userId: string, familyId: string): Promise<IssuedSession> {
    const refresh = this.tokens.newRefreshToken();
    const refreshExpiresAt = this.clock.now() + REFRESH_TTL_MS;
    await this.repo.insertRefresh({
      id: newId(),
      userId,
      familyId,
      tokenHash: refresh.hash,
      expiresAt: new Date(refreshExpiresAt),
    });
    const access = await this.tokens.issueAccess(userId);
    return {
      userId,
      accessToken: access.token,
      expiresAt: access.expiresAt,
      refreshToken: refresh.raw,
      refreshExpiresAt,
    };
  }
}
