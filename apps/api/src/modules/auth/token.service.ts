import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { Clock } from '../../common/clock.js';
import { AppConfig } from '../../config/app-config.js';
import { ACCESS_TTL_MS, JWT_AUDIENCE, JWT_ISSUER } from './constants.js';

export interface AccessToken {
  readonly token: string;
  /** epoch ms, alineado al segundo del `exp` del JWT. */
  readonly expiresAt: number;
}

/** SHA-256 del refresh: la base nunca guarda el token en claro (BE10). */
export const hashRefreshToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;

  constructor(
    config: AppConfig,
    private readonly clock: Clock,
  ) {
    this.secret = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET'));
  }

  async issueAccess(userId: string): Promise<AccessToken> {
    const issuedAt = Math.floor(this.clock.now() / 1000);
    const expiresAt = issuedAt + ACCESS_TTL_MS / 1000;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.secret);
    return { token, expiresAt: expiresAt * 1000 };
  }

  /** `userId` si el token es válido y vigente; `null` en cualquier otro caso. */
  async verifyAccess(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
        currentDate: new Date(this.clock.now()),
      });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /** Refresh opaco de 256 bits. */
  newRefreshToken(): { readonly raw: string; readonly hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: hashRefreshToken(raw) };
  }
}
