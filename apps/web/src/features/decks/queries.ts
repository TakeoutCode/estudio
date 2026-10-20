import type { Deck, Topic } from '@estudio/shared';
import { type LoadSummary, loadSummary } from '@estudio/srs';
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
  /** §5: tarjetas, pendientes hoy y nuevas, con la regla de la cola. */
  readonly load: LoadSummary;
}

/** Mazos vivos por nombre, cada uno con su carga; se recalcula tras responder o un pull. */
export const useDeckOverview = (): DeckOverview[] | undefined =>
  useLiveQuery(async () => {
    const now = Date.now();
    const [decks, { cards }, config, profile] = await Promise.all([
      alive(db.decks.toCollection()).toArray(),
      readPlannerCards(db),
      readStudyConfig(db),
      readProfile(db),
    ]);
    return decks
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((deck) => ({
        deck,
        load: loadSummary(
          cards.filter((card) => card.deckId === deck.id),
          now,
          profile.timeZone,
          config.planner,
        ),
      }));
  }, []);
