import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaTxHost } from '../../prisma/transaction.js';

export interface UserRecord {
  readonly id: string;
  readonly passwordHash: string;
}

export interface RefreshRecord {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly rotatedAt: Date | null;
  readonly revokedAt: Date | null;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.tx.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  }

  /** `false` si el correo ya existía (carrera entre dos registros). */
  async createUser(user: { id: string; email: string; passwordHash: string }): Promise<boolean> {
    try {
      await this.tx.user.create({ data: user });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  async insertRefresh(token: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.tx.refreshToken.create({ data: token });
  }

  /** Bloquea la fila: dos refresh simultáneos con el mismo token se serializan. */
  async findRefreshForUpdate(tokenHash: string): Promise<RefreshRecord | null> {
    const rows = await this.tx.$queryRaw<RefreshRecord[]>`
      SELECT "id", "user_id" AS "userId", "family_id" AS "familyId", "expires_at" AS "expiresAt",
             "rotated_at" AS "rotatedAt", "revoked_at" AS "revokedAt"
      FROM "refresh_token" WHERE "token_hash" = ${tokenHash}
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  findRefresh(tokenHash: string): Promise<{ familyId: string } | null> {
    return this.tx.refreshToken.findUnique({ where: { tokenHash }, select: { familyId: true } });
  }

  async markRotated(id: string, at: Date): Promise<void> {
    await this.tx.refreshToken.update({ where: { id }, data: { rotatedAt: at } });
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.tx.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at } });
  }
}
