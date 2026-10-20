import type { Deck, Note } from '@estudio/shared';
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
