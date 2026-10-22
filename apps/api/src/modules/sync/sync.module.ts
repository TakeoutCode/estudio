import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { HealthModule } from '../health/health.module.js';
import { SyncPushMetrics } from './sync-push.metrics.js';
import { SyncHandlerRegistry } from './sync-handler.js';
import { SyncPurgeScheduler } from './sync-purge.scheduler.js';
import { SyncPurgeService } from './sync-purge.service.js';
import { SyncController } from './sync.controller.js';
import { SyncRepository } from './sync.repository.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [DiscoveryModule, HealthModule],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncRepository,
    SyncHandlerRegistry,
    SyncPushMetrics,
    SyncPurgeService,
    SyncPurgeScheduler,
  ],
})
export class SyncModule {}
