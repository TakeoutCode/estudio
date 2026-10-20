import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsScheduler } from './notifications.scheduler.js';
import { NotificationsService } from './notifications.service.js';
import { PushSender, WebPushSender } from './push-sender.js';

/** Suscripciones, cron y envíos programados (BACKEND §1, NOTIFICATIONS.md). */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationsScheduler,
    { provide: PushSender, useClass: WebPushSender },
  ],
})
export class NotificationsModule {}
