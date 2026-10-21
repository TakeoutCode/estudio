import type { MediaAsset } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { syncMetaColumns, upsertLwwSql } from '../sync/sql.js';
import type { ApplyStatus } from '../sync/sync-handler.js';

@Injectable()
export class MediaRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  async upsertMediaAssetLww(userId: string, asset: MediaAsset): Promise<ApplyStatus> {
    const rows = await this.tx.$queryRaw<{ server_seq: bigint }[]>(
      upsertLwwSql('media_asset', [
        { name: 'id', value: asset.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'kind', value: asset.kind },
        { name: 'mime', value: asset.mime },
        { name: 'bytes', value: asset.bytes, cast: 'integer' },
        { name: 'width', value: asset.width, cast: 'integer' },
        { name: 'height', value: asset.height, cast: 'integer' },
        { name: 'public_id', value: asset.publicId },
        { name: 'version', value: asset.version, cast: 'bigint' },
        ...syncMetaColumns(asset),
      ]),
    );
    return rows.length > 0 ? 'applied' : 'stale';
  }

  /** Para firmar: el asset existe, es de ella y no está borrado. */
  async isAlive(userId: string, id: string): Promise<boolean> {
    const rows = await this.tx.$queryRaw<unknown[]>`
      SELECT 1 FROM "media_asset"
      WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid AND "deleted_at" IS NULL`;
    return rows.length > 0;
  }
}
