import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { ClinicalCaseDraftsService } from './clinical-case-drafts.service.js';
import { ExercisesController } from './exercises.controller.js';

/**
 * Ejercicios de aplicación (BACKEND §1). Son notas y viajan con el handler `Note` de `decks`;
 * aquí queda lo que no es sync: los borradores de casos clínicos con IA (LD14).
 */
@Module({
  imports: [AiModule],
  controllers: [ExercisesController],
  providers: [ClinicalCaseDraftsService],
})
export class ExercisesModule {}
