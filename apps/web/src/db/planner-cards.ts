import type { Note } from '@estudio/shared';
import { newCardState, type PlannerCard } from '@estudio/srs';
import { alive, type EstudioDb } from './schema';

/** Tarjeta para el planificador, con la nota y el mazo de donde sale. */
export interface DeckPlannerCard extends PlannerCard {
  readonly noteId: string;
  readonly deckId: string;
  /** Etiquetas de su nota (diseño): estudiar una etiqueta filtra por aquí. */
  readonly tagIds: readonly string[];
  /** Su mazo está en pausa: no entra en Hoy ni en la carga (LEARNING-DESIGN §6). */
  readonly deckPaused: boolean;
}

/**
 * Mazos en pausa (*diseño*, `Deck.pausedAt`): sus tarjetas no entran en Hoy, en la carga de Tu
 * semana ni en la carga proyectada de Ajustes. Exámenes y estudiar ese mazo a propósito sí las
 * ven, porque ella eligió ese alcance.
 */
export async function readPausedDeckIds(database: EstudioDb): Promise<ReadonlySet<string>> {
  const decks = await alive(database.decks.toCollection()).toArray();
  return new Set(decks.filter((deck) => deck.pausedAt !== null).map((deck) => deck.id));
}

/**
 * Lo que lee el planificador (ARC3): tarjetas vivas de notas vivas, con su estado FSRS (uno
 * nuevo si nunca se respondió), su tema y su mazo. La cola de Hoy y la carga de cada mazo
 * salen de aquí, así cuentan lo mismo.
 */
export async function readPlannerCards(database: EstudioDb): Promise<{
  readonly cards: DeckPlannerCard[];
  readonly notes: ReadonlyMap<string, Note>;
  readonly pausedDeckIds: ReadonlySet<string>;
}> {
  const [paused, aliveNotes] = await Promise.all([
    readPausedDeckIds(database),
    alive(database.notes.toCollection()).toArray(),
  ]);
  const notes = new Map(aliveNotes.map((n) => [n.id, n]));
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
        tagIds: note.tagIds,
        deckPaused: paused.has(note.deckId),
      },
    ];
  });
  return { cards: planned, notes, pausedDeckIds: paused };
}
