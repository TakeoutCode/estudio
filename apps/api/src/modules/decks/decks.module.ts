import { Module } from '@nestjs/common';
import { CardSyncHandler } from './card.sync-handler.js';
import { DeckSyncHandler } from './deck.sync-handler.js';
import { DecksRepository } from './decks.repository.js';
import { NoteSyncHandler } from './note.sync-handler.js';

/** `study` usa el repositorio para validar el `cardId` de cada repaso (BE2). */
@Module({
  providers: [DecksRepository, DeckSyncHandler, NoteSyncHandler, CardSyncHandler],
  exports: [DecksRepository],
})
export class DecksModule {}
