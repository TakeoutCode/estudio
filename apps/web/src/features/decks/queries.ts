import { cardFaces, clozeNumbers, type Deck, type NoteContent, type Topic } from '@estudio/shared';
import { type LoadSummary, loadSummary, normalizeAnswer } from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { readPlannerCards } from '@/db/planner-cards';
import { alive, db } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';

/** El tema a editar; `null` si no existe o está borrado. */
export const useTopic = (id: string | undefined): Topic | null | undefined =>
  useLiveQuery(async () => {
    if (!id) return null;
    const topic = await db.topics.get(id);
    return topic?.deletedAt === null ? topic : null;
  }, [id]);

export interface DeckOverview {
  readonly deck: Deck;
  /** §5: pendientes hoy y nuevas, con la regla de la cola. */
  readonly load: LoadSummary;
  /** Notas vivas: lo que la UI llama "tarjetas" (LD §1). */
  readonly notes: number;
}

export interface DeckNoteRow {
  readonly id: string;
  /** La pregunta de su primera tarjeta, sin la respuesta: es una lista para editar, no para repasar. */
  readonly label: string;
  readonly kind: NoteContent['kind'];
  readonly topicName: string | null;
  /** Pregunta y respuesta normalizadas (acentos, mayúsculas) para buscar. */
  readonly search: string;
}

export interface DeckDetail {
  readonly deck: Deck;
  readonly load: LoadSummary;
  /** Temas vivos por nombre (LD5, P4). */
  readonly topics: readonly Topic[];
  /** Notas vivas en el orden en que se crearon (UUIDv7), como entran las nuevas (P4). */
  readonly notes: readonly DeckNoteRow[];
}

const firstLabel = (content: NoteContent): string => {
  const ordinal = content.kind === 'cloze' ? (clozeNumbers(content.text)[0] ?? 1) : 0;
  return cardFaces(content, ordinal).prompt.split('\n')[0] ?? '';
};

const searchText = (content: NoteContent): string => {
  const parts =
    content.kind === 'cloze'
      ? [content.text]
      : content.kind === 'multiple_choice'
        ? [content.question, ...content.options]
        : [content.front, content.back];
  return normalizeAnswer(parts.join(' '));
};

/** Lo que se busca se compara igual que las notas: sin acentos ni mayúsculas. */
export const matchesSearch = (row: DeckNoteRow, query: string): boolean =>
  row.search.includes(normalizeAnswer(query));

/** Un mazo con su carga, sus temas y sus notas; `null` si no existe o está borrado. */
export const useDeckDetail = (deckId: string | undefined): DeckDetail | null | undefined =>
  useLiveQuery(async () => {
    if (!deckId) return null;
    const deck = await db.decks.get(deckId);
    if (deck?.deletedAt !== null) return null;
    const now = Date.now();
    const [topics, notes, { cards }, config, profile] = await Promise.all([
      alive(db.topics.where('deckId').equals(deckId)).toArray(),
      alive(db.notes.where('deckId').equals(deckId)).toArray(),
      readPlannerCards(db),
      readStudyConfig(db),
      readProfile(db),
    ]);
    const topicName = new Map(topics.map((t) => [t.id, t.name]));
    return {
      deck,
      load: loadSummary(
        cards.filter((card) => card.deckId === deckId),
        now,
        profile.timeZone,
        config.planner,
      ),
      topics: topics.sort((a, b) => a.name.localeCompare(b.name, 'es')),
      notes: notes
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((note) => ({
          id: note.id,
          label: firstLabel(note.content),
          kind: note.content.kind,
          topicName: note.topicId ? (topicName.get(note.topicId) ?? null) : null,
          search: searchText(note.content),
        })),
    };
  }, [deckId]);

/**
 * Mazos vivos por nombre, primero los activos y después los que están en pausa, cada uno con
 * su carga; se recalcula tras responder o un pull.
 */
export const useDeckOverview = (): DeckOverview[] | undefined =>
  useLiveQuery(async () => {
    const now = Date.now();
    const [decks, { cards }, config, profile] = await Promise.all([
      alive(db.decks.toCollection()).toArray(),
      readPlannerCards(db),
      readStudyConfig(db),
      readProfile(db),
    ]);
    const paused = (deck: Deck) => (deck.pausedAt === null ? 0 : 1);
    return decks
      .sort((a, b) => paused(a) - paused(b) || a.name.localeCompare(b.name, 'es'))
      .map((deck) => {
        const own = cards.filter((card) => card.deckId === deck.id);
        return {
          deck,
          load: loadSummary(own, now, profile.timeZone, config.planner),
          notes: new Set(own.map((card) => card.noteId)).size,
        };
      });
  }, []);
