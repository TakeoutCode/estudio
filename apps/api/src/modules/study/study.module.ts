import { Module } from '@nestjs/common';
import { DecksModule } from '../decks/decks.module.js';
import { ReviewLogSyncHandler } from './review-log.sync-handler.js';
import { SelfExplanationSyncHandler } from './self-explanation.sync-handler.js';
import { SleepLogSyncHandler } from './sleep-log.sync-handler.js';
import { StudySessionSyncHandler } from './study-session.sync-handler.js';
import { StudyRepository } from './study.repository.js';
import { TimerBlockLogSyncHandler } from './timer-block-log.sync-handler.js';
import { TimerSessionSyncHandler } from './timer-session.sync-handler.js';

@Module({
  imports: [DecksModule],
  providers: [
    StudyRepository,
    ReviewLogSyncHandler,
    TimerSessionSyncHandler,
    TimerBlockLogSyncHandler,
    SelfExplanationSyncHandler,
    StudySessionSyncHandler,
    SleepLogSyncHandler,
  ],
})
export class StudyModule {}
