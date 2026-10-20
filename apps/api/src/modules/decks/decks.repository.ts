import type { Deck } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { syncMetaColumns, upsertLwwSql } from '../sync/sql.js';
import type { ApplyStatus } from '../sync/sync-handler.js';

@Injectable()
export class DecksRepository {
  constructor(private readonly txHost: TransactionHost) {}

  async upsertLww(userId: string, deck: Deck): Promise<ApplyStatus> {
    const rows = await (this.txHost as PrismaTxHost).tx.$queryRaw<{ server_seq: bigint }[]>(
      upsertLwwSql('deck', [
        { name: 'id', value: deck.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'name', value: deck.name },
        { name: 'description', value: deck.description },
        ...syncMetaColumns(deck),
      ]),
    );
    return rows.length > 0 ? 'applied' : 'stale';
  }
}
