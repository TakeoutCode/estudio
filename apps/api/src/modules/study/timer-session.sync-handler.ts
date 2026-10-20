import {
  decodeHlc,
  defaultStudyConfig,
  encodeHlc,
  isTimerActive,
  SERVER_NODE,
  tickHlc,
  type TimerSession,
  TimerSessionSchema,
} from '@estudio/shared';
import { transition } from '@estudio/srs';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { dbNumber, dbNumberOrNull } from '../sync/sql.js';
import { type ApplyStatus, type EntitySyncHandler, SyncHandler } from '../sync/sync-handler.js';
import { StudyRepository } from './study.repository.js';

/**
 * SYNC SY7 y ADR-006: un solo temporizador activo por cuenta. Las transiciones las valida la
 * máquina de `srs` en el cliente; aquí solo se hace cumplir la unicidad (SYNC §5).
 */
@Injectable()
@SyncHandler('timerSession')
export class TimerSessionSyncHandler implements EntitySyncHandler<'timerSession'> {
  readonly entity = 'timerSession';
  readonly table = 'timer_session';

  constructor(
    private readonly repo: StudyRepository,
    private readonly clock: Clock,
  ) {}

  check(): null {
    return null;
  }

  async apply(userId: string, row: TimerSession): Promise<ApplyStatus> {
    const status = await this.repo.upsertTimerSessionLww(userId, row);
    if (status === 'applied' && isTimerActive(row)) await this.keepNewestActive(userId);
    return status;
  }

  /**
   * SY-T11: con dos sesiones activas queda la de HLC mayor; la otra se cierra con la
   * transición `stop` de la máquina (`superseded`) y un HLC del servidor que le gana a la
   * suya, así esa escritura viaja por pull a los dos dispositivos. Sus bloques ya cerrados
   * se conservan.
   */
  private async keepNewestActive(userId: string): Promise<void> {
    const [, ...older] = (await this.repo.activeTimerSessions(userId)).map((data) =>
      TimerSessionSchema.parse(this.fromDb(data)),
    );
    const now = this.clock.now();
    // `stop` solo usa la configuración para decidir el desenlace del bloque, que aquí no se guarda.
    const cfg = defaultStudyConfig().timer;
    for (const session of older) {
      const { timer } = transition(session, { type: 'stop', now, reason: 'superseded' }, cfg);
      const hlc = tickHlc({ ...decodeHlc(session.hlc), node: SERVER_NODE }, now);
      await this.repo.upsertTimerSessionLww(userId, {
        ...session,
        ...timer,
        hlc: encodeHlc(hlc),
        updatedAt: hlc.wall,
      });
    }
  }

  fromDb(d: Readonly<Record<string, unknown>>): unknown {
    return {
      id: d.id,
      state: d.state,
      mode: d.mode,
      startedAt: dbNumberOrNull(d.started_at),
      pausedAt: dbNumberOrNull(d.paused_at),
      pausedMs: dbNumber(d.paused_ms),
      blockIndex: dbNumber(d.block_index),
      completedBlocks: dbNumber(d.completed_blocks),
      plannedMs: dbNumber(d.planned_ms),
      extendedThisBlock: d.extended_this_block,
      ownerDeviceId: d.owner_device_id,
      lastSeenAt: dbNumberOrNull(d.last_seen_at),
      endedReason: d.ended_reason,
      hlc: d.hlc,
      updatedAt: dbNumber(d.updated_at),
      deletedAt: dbNumberOrNull(d.deleted_at),
    };
  }
}
