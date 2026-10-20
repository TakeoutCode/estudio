import type { Card, Deck, Mutation, Note, ReviewLog, SyncedEntity, UserSettings } from '@estudio/shared';
import type { CardState } from '@estudio/srs';
import { type Collection, Dexie, type EntityTable } from 'dexie';

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

/** Cursor del pull en `meta` (SYNC SY4). */
export const SYNC_CURSOR_KEY = 'syncCursor';

/** Tabla de Dexie de cada entidad que se sincroniza. */
export const TABLE_FOR = {
  deck: 'decks',
  note: 'notes',
  card: 'cards',
  userSettings: 'userSettings',
  reviewLog: 'reviewLogs',
} as const satisfies Record<SyncedEntity, string>;

/** IndexedDB es la fuente local de la UI (ARCHITECTURE ARC3). */
export class EstudioDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  cards!: EntityTable<Card, 'id'>;
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
    // Una versión anterior ignoraba `note` y `card` del pull pero avanzaba el cursor: se
    // vuelve a bajar todo (LWW e inserción son idempotentes) y el outbox queda intacto.
    this.version(3)
      .stores({ notes: 'id, deckId', cards: 'id, noteId' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
  }
}

export const db = new EstudioDb();

/** Tablas que toca un pull: datos sincronizados, su proyección y meta (cursor y reloj). */
export const syncedTables = (database: EstudioDb) => [
  database.decks,
  database.notes,
  database.cards,
  database.userSettings,
  database.reviewLogs,
  database.cardStates,
  database.meta,
];

/** Excluye lo borrado (SYNC §6): toda lectura de entidades LWW pasa por aquí. */
export const alive = <T extends { readonly deletedAt: number | null }, K, I>(
  collection: Collection<T, K, I>,
) => collection.filter((row) => row.deletedAt === null);
