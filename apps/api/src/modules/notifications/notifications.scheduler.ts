import { NOTIFICATION_DELIVERY } from '@estudio/shared';
import { Injectable } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { Clock } from '../../common/clock.js';
import { NotificationsService } from './notifications.service.js';

const TICK_MS = NOTIFICATION_DELIVERY.reminderTickMinutes * 60_000;

/**
 * BE14: los dos disparadores de NOTIFICATIONS §4. Cada instancia corre los suyos; el advisory
 * lock y la unicidad por (cuenta, día) evitan duplicados en un redeploy solapado (ARC7).
 */
@Injectable()
export class NotificationsScheduler {
  private lastReminderTick: number | null = null;

  constructor(
    private readonly service: NotificationsService,
    private readonly clock: Clock,
  ) {}

  /** NT3: en minutos exactos (:00, :05...) para que la hora elegida llegue a tiempo. */
  @Cron(`*/${String(NOTIFICATION_DELIVERY.reminderTickMinutes)} * * * *`)
  async reminders(): Promise<void> {
    const now = this.clock.now();
    const since = this.lastReminderTick ?? now - TICK_MS;
    this.lastReminderTick = now;
    await this.service.runReminderTick(now, since);
  }

  /** NT4: unos ±30 s de precisión (NT8). */
  @Interval(NOTIFICATION_DELIVERY.breakEndPollSeconds * 1000)
  async breakEnds(): Promise<void> {
    await this.service.runBreakEndTick(this.clock.now());
  }
}
