import { Module } from '@nestjs/common';
import { CardSyncHandler } from './card.sync-handler.js';
import { ContrastGroupSyncHandler } from './contrast-group.sync-handler.js';
import { DeckSyncHandler } from './deck.sync-handler.js';
import { DecksRepository } from './decks.repository.js';
import { NoteSyncHandler } from './note.sync-handler.js';
import { TagSyncHandler } from './tag.sync-handler.js';
import { TopicSyncHandler } from './topic.sync-handler.js';

/** `study` usa el repositorio para validar el `cardId` de cada repaso y el `topicId` (BE2). */
@Module({
  providers: [
    DecksRepository,
    DeckSyncHandler,
    TopicSyncHandler,
    TagSyncHandler,
    NoteSyncHandler,
    CardSyncHandler,
    ContrastGroupSyncHandler,
  ],
  exports: [DecksRepository],
})
export class DecksModule {}
