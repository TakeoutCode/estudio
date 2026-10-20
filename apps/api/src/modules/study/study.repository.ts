import type { TimerBlockLog, TimerSession } from '@estudio/shared';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import type { PrismaTxHost } from '../../prisma/transaction.js';
import { insertAppendSql, syncMetaColumns, upsertLwwSql } from '../sync/sql.js';
import type { ApplyStatus } from '../sync/sync-handler.js';

@Injectable()
export class StudyRepository {
  constructor(private readonly txHost: TransactionHost) {}

  private get tx() {
    return (this.txHost as PrismaTxHost).tx;
  }

  async upsertTimerSessionLww(userId: string, s: TimerSession): Promise<ApplyStatus> {
    const rows = await this.tx.$queryRaw<{ server_seq: bigint }[]>(
      upsertLwwSql('timer_session', [
        { name: 'id', value: s.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'state', value: s.state },
        { name: 'mode', value: s.mode },
        { name: 'started_at', value: s.startedAt, cast: 'bigint' },
        { name: 'paused_at', value: s.pausedAt, cast: 'bigint' },
        { name: 'paused_ms', value: s.pausedMs, cast: 'bigint' },
        { name: 'block_index', value: s.blockIndex, cast: 'integer' },
        { name: 'completed_blocks', value: s.completedBlocks, cast: 'integer' },
        { name: 'planned_ms', value: s.plannedMs, cast: 'bigint' },
        { name: 'extended_this_block', value: s.extendedThisBlock },
        { name: 'owner_device_id', value: s.ownerDeviceId, cast: 'uuid' },
        { name: 'last_seen_at', value: s.lastSeenAt, cast: 'bigint' },
        { name: 'ended_reason', value: s.endedReason },
        ...syncMetaColumns(s),
      ]),
    );
    return rows.length > 0 ? 'applied' : 'stale';
  }

  /** SY7: sesiones vivas que cuentan como activas, de HLC mayor a menor (byte a byte). */
  activeTimerSessions(userId: string): Promise<Record<string, unknown>[]> {
    return this.tx.$queryRaw<Record<string, unknown>[]>`
      SELECT to_jsonb(t) AS "data" FROM "timer_session" t
      WHERE t."user_id" = ${userId}::uuid AND t."deleted_at" IS NULL
        AND t."state" NOT IN ('idle', 'ended')
      ORDER BY t."hlc" COLLATE "C" DESC`.then((rows) => rows.map((r) => r.data as Record<string, unknown>));
  }

  async insertTimerBlockLog(userId: string, b: TimerBlockLog): Promise<ApplyStatus> {
    const rows = await this.tx.$queryRaw<{ server_seq: bigint }[]>(
      insertAppendSql('timer_block_log', [
        { name: 'id', value: b.id, cast: 'uuid' },
        { name: 'user_id', value: userId, cast: 'uuid' },
        { name: 'timer_session_id', value: b.timerSessionId, cast: 'uuid' },
        { name: 'device_id', value: b.deviceId, cast: 'uuid' },
        { name: 'kind', value: b.kind },
        { name: 'block_index', value: b.blockIndex, cast: 'integer' },
        { name: 'mode', value: b.mode },
        { name: 'started_at', value: b.startedAt, cast: 'bigint' },
        { name: 'ended_at', value: b.endedAt, cast: 'bigint' },
        { name: 'planned_ms', value: b.plannedMs, cast: 'bigint' },
        { name: 'active_ms', value: b.activeMs, cast: 'bigint' },
        { name: 'outcome', value: b.outcome },
      ]),
    );
    return rows.length > 0 ? 'applied' : 'duplicate';
  }

  /** BE2: la sesión existe y es de ella (aunque esté terminada o borrada). */
  async ownsTimerSession(userId: string, id: string): Promise<boolean> {
    const rows = await this.tx.$queryRaw<unknown[]>`
      SELECT 1 FROM "timer_session" WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid`;
    return rows.length > 0;
  }
}
