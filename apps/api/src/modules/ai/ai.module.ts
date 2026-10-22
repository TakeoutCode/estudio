import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module.js';
import { AiDraftSyncHandler } from './ai-draft.sync-handler.js';
import { AiFeedbackSyncHandler } from './ai-feedback.sync-handler.js';
import { AiProvider, OpenAiProvider } from './ai-provider.js';
import { AiController } from './ai.controller.js';
import { AiRepository } from './ai.repository.js';
import { AiService } from './ai.service.js';

/** Borradores y retroalimentación con IA, con cuota diaria (BACKEND §1, LEARNING-DESIGN §8). */
@Module({
  imports: [HealthModule],
  controllers: [AiController],
  providers: [
    AiRepository,
    AiService,
    AiDraftSyncHandler,
    AiFeedbackSyncHandler,
    { provide: AiProvider, useClass: OpenAiProvider },
  ],
  // Los casos clínicos (`exercises`) usan la misma cuota, reintento y registro de uso.
  exports: [AiService],
})
export class AiModule {}
