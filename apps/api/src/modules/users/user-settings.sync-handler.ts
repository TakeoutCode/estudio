import { type ApiErrorCode, settingsRowId, type UserSettings } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { dbNumber, dbNumberOrNull, syncMetaColumns, upsertLwwSql } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';

@Injectable()
@SyncHandler('userSettings')
export class UserSettingsSyncHandler implements EntitySyncHandler<'userSettings'> {
  readonly entity = 'userSettings';
  readonly table = 'user_settings';

  constructor(private readonly txHost: TransactionHost) {}

  /** SYNC §1: el id de cada sección es determinista; otro id duplicaría la sección. */
  check(userId: string, row: UserSettings): ApiErrorCode | null {
    return row.id === settingsRowId(userId, row.section) ? null : 'validation_failed';
  }

  async apply(userId: string, row: UserSettings): Promise<ApplyStatus> {
    const rows = await (this.txHost as PrismaTxHost).tx.$queryRaw<{ server_seq: bigint }[]>(
      upsertLwwSql('user_settings', [
        { name: 'id', value: row.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'section', value: row.section },
        { name: 'data', value: JSON.stringify(row.data), cast: 'jsonb' },
        ...syncMetaColumns(row),
      ]),
    );
    return rows.length > 0 ? 'applied' : 'stale';
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      section: d.section,
      data: d.data,
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
