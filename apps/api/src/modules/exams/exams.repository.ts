import type { Exam } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { syncMetaColumns, upsertLwwSql } from '../sync/sql.js';
import type { ApplyStatus } from '../sync/sync-handler.js';

@Injectable()
export class ExamsRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  async upsertExamLww(userId: string, exam: Exam): Promise<ApplyStatus> {
    const rows = await this.tx.$queryRaw<{ server_seq: bigint }[]>(
      upsertLwwSql('exam', [
        { name: 'id', value: exam.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'title', value: exam.title },
        { name: 'date', value: exam.date, cast: 'bigint' },
        { name: 'topic_ids', value: JSON.stringify(exam.topicIds), cast: 'jsonb' },
        ...syncMetaColumns(exam),
      ]),
    );
    return rows.length > 0 ? 'applied' : 'stale';
  }
}
