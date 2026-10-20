import { Module } from '@nestjs/common';
import { DecksModule } from '../decks/decks.module.js';
import { ReviewLogSyncHandler } from './review-log.sync-handler.js';

@Module({ imports: [DecksModule], providers: [ReviewLogSyncHandler] })
export class StudyModule {}
