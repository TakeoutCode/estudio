import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  findPasswordHash(userId: string): Promise<{ passwordHash: string } | null> {
    return this.tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  }

  /**
   * QA6: borra la cuenta y, en cascada, todas sus filas (ON DELETE CASCADE hacia `user`). Las
   * tablas de solo inserción lo permiten solo con `app.allow_purge` (BE8, SYNC §6), que
   * `SET LOCAL` deja activo hasta el fin de esta transacción. El lock por usuario espera a un
   * push en curso (SYNC §3). Llamar dentro de `@Transactional()`.
   */
  async purge(userId: string): Promise<void> {
    await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
    await this.tx.$executeRaw`SET LOCAL app.allow_purge = 'on'`;
    await this.tx.$executeRaw`DELETE FROM "user" WHERE "id" = ${userId}::uuid`;
  }
}
