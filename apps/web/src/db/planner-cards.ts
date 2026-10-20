import type { Note } from '@estudio/shared';
import { newCardState, type PlannerCard } from '@estudio/srs';
import { alive, type EstudioDb } from './schema';

/** Tarjeta para el planificador, con la nota y el mazo de donde sale. */
export interface DeckPlannerCard extends PlannerCard {
  readonly noteId: string;
  readonly deckId: string;
}

/**
 * Lo que lee el planificador (ARC3): tarjetas vivas de notas vivas, con su estado FSRS (uno
 * nuevo si nunca se respondió), su tema y su mazo. La cola de Hoy y la carga de cada mazo
 * salen de aquí, así cuentan lo mismo.
 */
export async function readPlannerCards(
  database: EstudioDb,
): Promise<{ readonly cards: DeckPlannerCard[]; readonly notes: ReadonlyMap<string, Note> }> {
  const notes = new Map((await alive(database.notes.toCollection()).toArray()).map((n) => [n.id, n]));
  const cards = (await alive(database.cards.toCollection()).toArray()).filter((c) => notes.has(c.noteId));
  const stored = await database.cardStates.bulkGet(cards.map((c) => c.id));
  const planned = cards.flatMap((card, i) => {
    const note = notes.get(card.noteId);
    if (!note) return [];
    return [
      {
        state: stored[i] ?? newCardState(card.id, card.createdAt),
        topicId: note.topicId,
        lapseBaseline: card.lapseBaseline,
        noteId: note.id,
        deckId: note.deckId,
      },
    ];
  });
  return { cards: planned, notes };
}
