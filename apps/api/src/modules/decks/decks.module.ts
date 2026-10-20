import { Module } from '@nestjs/common';
import { DeckSyncHandler } from './deck.sync-handler.js';
import { DecksRepository } from './decks.repository.js';

@Module({ providers: [DecksRepository, DeckSyncHandler] })
export class DecksModule {}
