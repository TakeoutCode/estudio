import { cardFaces, cardOrdinals, type Deck, type NoteContent, type Tag, type Topic } from '@estudio/shared';
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
  /** Etiquetas vivas de la nota (diseño), para filtrar. */
  readonly tagIds: readonly string[];
  /** Pregunta y respuesta normalizadas (acentos, mayúsculas) para buscar. */
  readonly search: string;
}

export interface DeckDetail {
  readonly deck: Deck;
  readonly load: LoadSummary;
  /** Temas vivos por nombre (LD5, P4). */
  readonly topics: readonly Topic[];
  /** Etiquetas vivas que usan sus notas, por nombre. */
  readonly tags: readonly Tag[];
  /** Notas vivas en el orden en que se crearon (UUIDv7), como entran las nuevas (P4). */
  readonly notes: readonly DeckNoteRow[];
}

const firstLabel = (content: NoteContent): string =>
  cardFaces(content, cardOrdinals(content)[0] ?? 0).prompt.split('\n')[0] ?? '';

const searchParts = (content: NoteContent): readonly string[] => {
  switch (content.kind) {
    case 'cloze':
      return [content.text];
    case 'multiple_choice':
      return [content.question, ...content.options];
    case 'image_occlusion':
      return [content.prompt, ...content.groups.map((g) => g.label)];
    case 'basic':
    case 'type_answer':
      return [content.front, content.back];
    case 'true_false_justify':
      return [content.statement, content.justification];
    case 'open_question':
      return [content.question, content.key];
    case 'sequence':
      return [content.prompt, ...content.items];
    case 'matching':
      return [content.prompt, ...content.pairs.flatMap((p) => [p.left, p.right])];
  }
};

const searchText = (content: NoteContent): string => normalizeAnswer(searchParts(content).join(' '));

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
    const [topics, notes, allTags, { cards }, config, profile] = await Promise.all([
      alive(db.topics.where('deckId').equals(deckId)).toArray(),
      alive(db.notes.where('deckId').equals(deckId)).toArray(),
      alive(db.tags.toCollection()).toArray(),
      readPlannerCards(db),
      readStudyConfig(db),
      readProfile(db),
    ]);
    const topicName = new Map(topics.map((t) => [t.id, t.name]));
    const aliveTags = new Set(allTags.map((tag) => tag.id));
    const used = new Set(notes.flatMap((note) => note.tagIds));
    return {
      deck,
      load: loadSummary(
        cards.filter((card) => card.deckId === deckId),
        now,
        profile.timeZone,
        config.planner,
      ),
      topics: topics.sort((a, b) => a.name.localeCompare(b.name, 'es')),
      tags: byName(allTags.filter((tag) => used.has(tag.id))),
      notes: notes
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((note) => ({
          id: note.id,
          label: firstLabel(note.content),
          kind: note.content.kind,
          topicName: note.topicId ? (topicName.get(note.topicId) ?? null) : null,
          tagIds: note.tagIds.filter((id) => aliveTags.has(id)),
          search: searchText(note.content),
        })),
    };
  }, [deckId]);

const byName = <T extends { readonly name: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.name.localeCompare(b.name, 'es'));

export interface TagOverview {
  readonly tag: Tag;
  /** §5: pendientes hoy y nuevas de sus tarjetas, de cualquier mazo (aunque esté en pausa). */
  readonly load: LoadSummary;
  /** Notas vivas con la etiqueta: las "tarjetas" de la UI. */
  readonly notes: number;
}

/**
 * Etiquetas vivas por nombre, cada una con su carga (diseño). Estudiar una etiqueta es como
 * estudiar un mazo: ella elige ese alcance, así que entran también los mazos en pausa.
 */
export const useTagOverview = (): TagOverview[] | undefined =>
  useLiveQuery(async () => {
    const now = Date.now();
    const [tags, { cards }, config, profile] = await Promise.all([
      alive(db.tags.toCollection()).toArray(),
      readPlannerCards(db),
      readStudyConfig(db),
      readProfile(db),
    ]);
    return byName(tags).map((tag) => {
      const own = cards.filter((card) => card.tagIds.includes(tag.id));
      return {
        tag,
        load: loadSummary(own, now, profile.timeZone, config.planner),
        notes: new Set(own.map((card) => card.noteId)).size,
      };
    });
  }, []);

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
