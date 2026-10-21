import type { Deck, Note, Tag, Topic } from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db } from '@/db/schema';

/** Mazos vivos, del más reciente al más antiguo; `undefined` mientras carga. */
export const useDecks = (): Deck[] | undefined =>
  useLiveQuery(async () => (await alive(db.decks.toCollection()).sortBy('updatedAt')).reverse(), []);

/** La nota a editar; `null` si no existe o está borrada. */
export const useNote = (id: string | undefined): Note | null | undefined =>
  useLiveQuery(async () => {
    if (!id) return null;
    const note = await db.notes.get(id);
    return note?.deletedAt === null ? note : null;
  }, [id]);

/** Temas vivos de un mazo, por nombre; `undefined` mientras carga (LD5, P4). */
export const useTopics = (deckId: string | null): Topic[] | undefined =>
  useLiveQuery(async () => {
    if (!deckId) return [];
    const topics = await alive(db.topics.where('deckId').equals(deckId)).toArray();
    return topics.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [deckId]);

/** Etiquetas vivas, por nombre (diseño); `undefined` mientras carga. */
export const useTags = (): Tag[] | undefined =>
  useLiveQuery(async () => {
    const tags = await alive(db.tags.toCollection()).toArray();
    return tags.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, []);
