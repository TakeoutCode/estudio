import type { Deck, Mutation, ReviewLog, SyncedEntity, UserSettings } from '@estudio/shared';
import type { CardState } from '@estudio/srs';
import { Dexie, type EntityTable } from 'dexie';

/** Entrada del outbox (SYNC §3). Las rechazadas se quedan, visibles en Ajustes (SY8). */
export interface OutboxEntry extends Mutation {
  readonly createdAt: number;
  readonly attempts: number;
  readonly status: 'pending' | 'rejected';
}

export interface MetaEntry {
  readonly key: string;
  readonly value: unknown;
}

/** Tabla de Dexie de cada entidad que se sincroniza. */
export const TABLE_FOR = {
  deck: 'decks',
  userSettings: 'userSettings',
  reviewLog: 'reviewLogs',
} as const satisfies Record<SyncedEntity, string>;

/** IndexedDB es la fuente local de la UI (ARCHITECTURE ARC3). */
export class EstudioDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  userSettings!: EntityTable<UserSettings, 'id'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  cardStates!: EntityTable<CardState, 'cardId'>;
  outbox!: EntityTable<OutboxEntry, 'mutationId'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'estudio') {
    super(name);
    // SYNC SY9: solo se agregan versiones; nunca se edita una ya publicada.
    this.version(1).stores({
      decks: 'id, updatedAt',
      reviewLogs: 'id, cardId, reviewedAt',
      cardStates: 'cardId, due',
      outbox: 'mutationId, createdAt, status',
      meta: 'key',
    });
    this.version(2).stores({ userSettings: 'id, section' });
  }
}

export const db = new EstudioDb();

/** Tablas que toca un pull (datos sincronizados + meta para cursor y reloj). */
export const syncedTables = (database: EstudioDb) => [
  database.decks,
  database.userSettings,
  database.reviewLogs,
  database.meta,
];
