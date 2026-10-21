import { type Deck, type Note, Rating, type Tag, type Topic } from '@estudio/shared';
import { isLeech } from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';

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

export interface MnemonicOffer {
  /** R14: ya la entiende (alguna de sus tarjetas tuvo un acierto) o ya tiene mnemotecnia. */
  readonly ready: boolean;
  /** P3: alguna de sus tarjetas está para reformular. */
  readonly reformulate: boolean;
}

/**
 * R14: la mnemotecnia es un andamio que ella crea tras entender el contenido, así que el editor
 * la ofrece después del primer acierto (cualquier calificación salvo Otra vez), como los sets de
 * contraste (LD10). P3: si la nota está para reformular, se lo sugiere junto con lo demás.
 */
export async function readMnemonicOffer(
  database: EstudioDb,
  note: Pick<Note, 'id' | 'mnemonic'>,
): Promise<MnemonicOffer> {
  const cards = await alive(database.cards.where('noteId').equals(note.id)).toArray();
  const ids = cards.map((card) => card.id);
  const [logs, states, config] = await Promise.all([
    database.reviewLogs.where('cardId').anyOf(ids).toArray(),
    database.cardStates.bulkGet(ids),
    readStudyConfig(database),
  ]);
  return {
    ready: note.mnemonic !== null || logs.some((log) => log.rating !== Rating.Again),
    reformulate: cards.some((card, i) => {
      const state = states[i];
      return state !== undefined && isLeech({ state, lapseBaseline: card.lapseBaseline }, config.planner);
    }),
  };
}

/** Depende solo del id y de la mnemotecnia: cada lectura de la nota trae otro objeto. */
export function useMnemonicOffer(note: Note | null): MnemonicOffer | null | undefined {
  const id = note?.id ?? null;
  const mnemonic = note?.mnemonic ?? null;
  return useLiveQuery(() => (id ? readMnemonicOffer(db, { id, mnemonic }) : null), [id, mnemonic]);
}

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
