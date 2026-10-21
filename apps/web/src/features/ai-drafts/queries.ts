import type { AiDraft, Deck } from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EstudioDb } from '@/db/schema';

export interface DeckAiDrafts {
  readonly deck: Deck;
  /** LD16: los que esperan su revisión, del más viejo al más nuevo. */
  readonly pending: readonly AiDraft[];
  /** Cuántos ya aceptó, para decirlo sin listarlos. */
  readonly accepted: number;
}

export async function readDeckAiDrafts(database: EstudioDb, deckId: string): Promise<DeckAiDrafts | null> {
  // Una sola espera: liveQuery observa lo leído antes del primer `await`.
  const [deck, drafts] = await Promise.all([
    database.decks.get(deckId),
    database.aiDrafts.where('deckId').equals(deckId).toArray(),
  ]);
  if (deck?.deletedAt !== null) return null;
  const alive = drafts.filter((d) => d.deletedAt === null);
  return {
    deck,
    pending: alive
      .filter((d) => d.status === 'draft')
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    accepted: alive.filter((d) => d.status === 'accepted').length,
  };
}

export const useDeckAiDrafts = (deckId: string | undefined): DeckAiDrafts | null | undefined =>
  useLiveQuery(() => (deckId ? readDeckAiDrafts(db, deckId) : null), [deckId]);
