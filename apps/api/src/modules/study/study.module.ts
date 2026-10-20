import { Module } from '@nestjs/common';
import { ReviewLogSyncHandler } from './review-log.sync-handler.js';

@Module({ providers: [ReviewLogSyncHandler] })
export class StudyModule {}
