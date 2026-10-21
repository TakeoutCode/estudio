import type {
  AiDraft,
  AiFeedback,
  ApiErrorCode,
  Card,
  ContrastGroup,
  Deck,
  Exam,
  ImageMime,
  MediaAsset,
  Mutation,
  Note,
  ReviewLog,
  Reward,
  RewardRedemption,
  SelfExplanation,
  SleepLog,
  StudySession,
  Tag,
  SyncedEntity,
  TimerBlockLog,
  TimerSession,
  Topic,
  UserSettings,
} from '@estudio/shared';
import type { CardState } from '@estudio/srs';
import { type Collection, Dexie, type EntityTable } from 'dexie';
import type { DiagnosticEntry } from './diagnostics';

/** Entrada del outbox (SYNC §3). Las rechazadas se quedan, visibles en Ajustes (SY8). */
export interface OutboxEntry extends Mutation {
  readonly createdAt: number;
  readonly attempts: number;
  readonly status: 'pending' | 'rejected';
  /** Por qué la rechazó el servidor, para decírselo en Ajustes › Sincronización (SY8). */
  readonly code?: ApiErrorCode;
}

export interface MetaEntry {
  readonly key: string;
  readonly value: unknown;
}

/**
 * FRONTEND FE8: los bytes de una imagen que este dispositivo todavía no sube. Mientras está
 * aquí, la imagen se ve desde esta copia; al subirse se borra y se ve desde Cloudinary. No se
 * sincroniza: es de este dispositivo.
 */
export interface PendingUpload {
  readonly assetId: string;
  readonly data: ArrayBuffer;
  readonly mime: ImageMime;
  readonly createdAt: number;
  readonly attempts: number;
}

/** Cursor del pull en `meta` (SYNC SY4). */
export const SYNC_CURSOR_KEY = 'syncCursor';
/** Desfase estimado con el reloj del servidor (`serverNow` del pull, SYNC SY7). */
export const SERVER_OFFSET_KEY = 'serverOffsetMs';

/** Tabla de Dexie de cada entidad que se sincroniza. */
export const TABLE_FOR = {
  deck: 'decks',
  topic: 'topics',
  tag: 'tags',
  note: 'notes',
  card: 'cards',
  exam: 'exams',
  contrastGroup: 'contrastGroups',
  mediaAsset: 'mediaAssets',
  userSettings: 'userSettings',
  selfExplanation: 'selfExplanations',
  studySession: 'studySessions',
  timerSession: 'timerSessions',
  sleepLog: 'sleepLogs',
  reward: 'rewards',
  aiDraft: 'aiDrafts',
  reviewLog: 'reviewLogs',
  timerBlockLog: 'timerBlockLogs',
  rewardRedemption: 'rewardRedemptions',
  aiFeedback: 'aiFeedback',
} as const satisfies Record<SyncedEntity, string>;

/** IndexedDB es la fuente local de la UI (ARCHITECTURE ARC3). */
export class EstudioDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  topics!: EntityTable<Topic, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  exams!: EntityTable<Exam, 'id'>;
  contrastGroups!: EntityTable<ContrastGroup, 'id'>;
  mediaAssets!: EntityTable<MediaAsset, 'id'>;
  pendingUploads!: EntityTable<PendingUpload, 'assetId'>;
  diagnostics!: EntityTable<DiagnosticEntry, 'id'>;
  userSettings!: EntityTable<UserSettings, 'id'>;
  selfExplanations!: EntityTable<SelfExplanation, 'id'>;
  studySessions!: EntityTable<StudySession, 'id'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  timerSessions!: EntityTable<TimerSession, 'id'>;
  timerBlockLogs!: EntityTable<TimerBlockLog, 'id'>;
  sleepLogs!: EntityTable<SleepLog, 'id'>;
  rewards!: EntityTable<Reward, 'id'>;
  rewardRedemptions!: EntityTable<RewardRedemption, 'id'>;
  aiDrafts!: EntityTable<AiDraft, 'id'>;
  aiFeedback!: EntityTable<AiFeedback, 'id'>;
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
    // Igual con el temporizador: la v3 ignoraba timerSession y timerBlockLog.
    this.version(4)
      .stores({ timerSessions: 'id, state', timerBlockLogs: 'id, timerSessionId, endedAt' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // §5 (uso de descansos): los bloques guardados antes no registraban si se extendieron.
    this.version(5)
      .stores({})
      .upgrade((tx) =>
        tx
          .table<{ extended?: boolean }, string>('timerBlockLogs')
          .toCollection()
          .modify((block) => {
            block.extended ??= false;
          }),
      );
    // LD5: temas y autoexplicaciones. Como en v3 y v4, el cursor vuelve a 0 por si otro
    // dispositivo ya los subió y esta versión los saltó.
    this.version(6)
      .stores({ topics: 'id, deckId', selfExplanations: 'id, topicId' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // R11: exámenes; igual que en v6, el cursor vuelve a 0.
    this.version(7)
      .stores({ exams: 'id, date' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // P7: simulacros (StudySession); igual que en v6 y v7, el cursor vuelve a 0.
    this.version(8)
      .stores({ studySessions: 'id, examId' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // Mazos en pausa (Deck.pausedAt): los guardados quedan activos. El cursor vuelve a 0 por
    // si otro dispositivo ya pausó un mazo y esta versión lo bajó sin el campo.
    this.version(9)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table<{ pausedAt?: number | null }, string>('decks')
          .toCollection()
          .modify((deck) => {
            deck.pausedAt ??= null;
          });
        await tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' });
      });
    // FE8: imágenes (MediaAsset) y la cola de subida de este dispositivo. Como en v6-v9, el
    // cursor vuelve a 0 por si otro dispositivo ya subió una imagen que esta versión saltó.
    this.version(10)
      .stores({ mediaAssets: 'id', pendingUploads: 'assetId' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // R9, LD10: grupos de contraste; como en v6-v10, el cursor vuelve a 0.
    this.version(11)
      .stores({ contrastGroups: 'id' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // §5: registro de sueño, una fila por noche; como en v6-v11, el cursor vuelve a 0.
    this.version(12)
      .stores({ sleepLogs: 'id, date' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // Etiquetas (diseño): la tabla y un índice multi-entrada para filtrar notas por etiqueta.
    // Las notas guardadas quedan sin etiquetas; el cursor vuelve a 0 por si otro dispositivo ya
    // etiquetó alguna que esta versión no podía leer.
    this.version(13)
      .stores({ tags: 'id', notes: 'id, deckId, *tagIds' })
      .upgrade(async (tx) => {
        await tx
          .table<{ tagIds?: string[] }, string>('notes')
          .toCollection()
          .modify((note) => {
            note.tagIds ??= [];
          });
        await tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' });
      });
    // UX10: premios (LWW) y canjes (solo inserción); como en v6-v13, el cursor vuelve a 0 por si
    // otro dispositivo ya creó alguno que esta versión saltó.
    this.version(14)
      .stores({ rewards: 'id', rewardRedemptions: 'id, rewardId' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // FE13: errores de este dispositivo esperando a enviarse; no se sincronizan, así que el
    // cursor no cambia.
    this.version(15).stores({ diagnostics: 'id, occurredAt, sent, sentAt' });
    // R14: la mnemotecnia de cada nota (no indexada); las guardadas quedan sin ella.
    this.version(16)
      .stores({})
      .upgrade((tx) =>
        tx
          .table<{ mnemonic?: string | null }, string>('notes')
          .toCollection()
          .modify((note) => {
            note.mnemonic ??= null;
          }),
      );
    // LD16: borradores de la IA por mazo; como en v6-v14, el cursor vuelve a 0 por si otro
    // dispositivo ya guardó alguno que esta versión saltó.
    this.version(17)
      .stores({ aiDrafts: 'id, deckId, status' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
    // LD14: la retroalimentación de IA de cada tarjeta (solo inserción); el cursor vuelve a 0.
    this.version(18)
      .stores({ aiFeedback: 'id, cardId' })
      .upgrade((tx) => tx.table<MetaEntry, string>('meta').put({ key: SYNC_CURSOR_KEY, value: '0' }));
  }
}

export const db = new EstudioDb();

/** Tablas que toca un pull: datos sincronizados, su proyección y meta (cursor y reloj). */
export const syncedTables = (database: EstudioDb) => [
  database.decks,
  database.topics,
  database.tags,
  database.notes,
  database.cards,
  database.exams,
  database.contrastGroups,
  database.mediaAssets,
  database.userSettings,
  database.selfExplanations,
  database.studySessions,
  database.reviewLogs,
  database.timerSessions,
  database.timerBlockLogs,
  database.sleepLogs,
  database.rewards,
  database.rewardRedemptions,
  database.aiDrafts,
  database.aiFeedback,
  database.cardStates,
  database.meta,
];

/** Excluye lo borrado (SYNC §6): toda lectura de entidades LWW pasa por aquí. */
export const alive = <T extends { readonly deletedAt: number | null }, K, I>(
  collection: Collection<T, K, I>,
) => collection.filter((row) => row.deletedAt === null);
