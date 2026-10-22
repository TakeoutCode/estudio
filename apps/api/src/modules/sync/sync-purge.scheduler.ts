import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Clock } from '../../common/clock.js';
import { SyncPurgeService } from './sync-purge.service.js';

/**
 * SYNC §3 y §6: una vez al día, a las 09:40 UTC (madrugada en México, sin pushes de ella). Cada
 * instancia corre la suya; el advisory lock evita que dos purguen a la vez (ARC7).
 */
@Injectable()
export class SyncPurgeScheduler {
  constructor(
    private readonly purge: SyncPurgeService,
    private readonly clock: Clock,
  ) {}

  @Cron('40 9 * * *')
  async daily(): Promise<void> {
    await this.purge.run(this.clock.now());
  }
}
