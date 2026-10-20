import { Module } from '@nestjs/common';
import { DecksModule } from '../decks/decks.module.js';
import { ExamSyncHandler } from './exam.sync-handler.js';
import { ExamsRepository } from './exams.repository.js';

/** Exámenes y su alcance (BACKEND §1). Valida los temas con el repositorio de `decks` (BE2). */
@Module({
  imports: [DecksModule],
  providers: [ExamsRepository, ExamSyncHandler],
})
export class ExamsModule {}
