import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { SyncHandlerRegistry } from './sync-handler.js';
import { SyncController } from './sync.controller.js';
import { SyncRepository } from './sync.repository.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [DiscoveryModule],
  controllers: [SyncController],
  providers: [SyncService, SyncRepository, SyncHandlerRegistry],
})
export class SyncModule {}
