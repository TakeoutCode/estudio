import { type ApiErrorCode, settingsRowId, type UserSettings } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
@SyncHandler('userSettings')
export class UserSettingsSyncHandler implements EntitySyncHandler<'userSettings'> {
  readonly entity = 'userSettings';
  readonly table = 'user_settings';

  constructor(private readonly repo: UsersRepository) {}

  /** SYNC §1: el id de cada sección es determinista; otro id duplicaría la sección. */
  check(userId: string, row: UserSettings): ApiErrorCode | null {
    return row.id === settingsRowId(userId, row.section) ? null : 'validation_failed';
  }

  apply(userId: string, row: UserSettings): Promise<ApplyStatus> {
    return this.repo.upsertSettingsLww(userId, row);
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
