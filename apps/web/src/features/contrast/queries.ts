import { cardFaces, cardOrdinals, type ContrastGroup, type Note } from '@estudio/shared';
import {
  type ContrastComparison,
  contrastComparison,
  type ContrastPlanGroup,
  contrastReadyAt,
  firstCorrectByCard,
  normalizeAnswer,
} from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';

/** Lo que el planificador necesita de cada tarjeta para armar los sets. */
interface PlanCard {
  readonly noteId: string;
  readonly state: { readonly cardId: string };
}

/**
 * LD10: grupos vivos para `buildSessionQueue`, con las Cards de cada nota que entran en este
 * plan (estudiar un mazo deja fuera a los miembros de otros mazos). Con sus nombres, para el
 * aviso del set.
 */
export async function readContrastPlan(
  database: EstudioDb,
  cards: readonly PlanCard[],
): Promise<{ readonly groups: ContrastPlanGroup[]; readonly names: ReadonlyMap<string, string> }> {
  const groups = await alive(database.contrastGroups.toCollection()).toArray();
  const byNote = new Map<string, string[]>();
  for (const card of cards) byNote.set(card.noteId, [...(byNote.get(card.noteId) ?? []), card.state.cardId]);
  return {
    groups: groups.map((g) => ({
      id: g.id,
      arm: g.abArm,
      members: g.noteIds.map((n) => byNote.get(n) ?? []),
    })),
    names: new Map(groups.map((g) => [g.id, g.name])),
  };
}

/** La primera línea de la pregunta de una nota, para listas. */
export const noteLabel = (note: Note): string =>
  cardFaces(note.content, cardOrdinals(note.content)[0] ?? 0).prompt.split('\n')[0] ?? '';

export interface MemberView {
  readonly noteId: string;
  readonly label: string;
  /** R9, P4: ya la acertó alguna vez. */
  readonly learned: boolean;
}

export type GroupStatus = 'ready' | 'learning' | 'too_few';

export interface ContrastGroupView {
  readonly group: ContrastGroup;
  /** Solo las notas vivas. */
  readonly members: readonly MemberView[];
  readonly status: GroupStatus;
}

export interface ContrastOverview {
  readonly groups: readonly ContrastGroupView[];
  readonly comparison: ContrastComparison;
  readonly minReviewsPerArm: number;
  readonly retentionMinDays: number;
}

/** R9, LD10: los grupos, si están listos para contrastar, y la comparación del A/B. */
export const useContrastOverview = (): ContrastOverview | undefined =>
  useLiveQuery(async () => {
    const [groups, notes, cards, logs, config] = await Promise.all([
      alive(db.contrastGroups.toCollection()).toArray(),
      alive(db.notes.toCollection()).toArray(),
      alive(db.cards.toCollection()).toArray(),
      db.reviewLogs.toArray(),
      readStudyConfig(db),
    ]);
    const noteById = new Map(notes.map((n) => [n.id, n]));
    const cardsByNote = new Map<string, string[]>();
    for (const card of cards) {
      if (noteById.has(card.noteId))
        cardsByNote.set(card.noteId, [...(cardsByNote.get(card.noteId) ?? []), card.id]);
    }
    const firstCorrect = firstCorrectByCard(logs);
    const plan: ContrastPlanGroup[] = groups.map((g) => ({
      id: g.id,
      arm: g.abArm,
      members: g.noteIds.map((n) => cardsByNote.get(n) ?? []),
    }));
    const views = groups
      .map((group, i): ContrastGroupView => {
        const members = group.noteIds.flatMap((noteId) => {
          const note = noteById.get(noteId);
          if (!note) return [];
          const learned = (cardsByNote.get(noteId) ?? []).some((id) => firstCorrect.has(id));
          return [{ noteId, label: noteLabel(note), learned }];
        });
        const ready = plan[i] ? contrastReadyAt(plan[i], firstCorrect) !== null : false;
        return { group, members, status: members.length < 2 ? 'too_few' : ready ? 'ready' : 'learning' };
      })
      .sort((a, b) => a.group.name.localeCompare(b.group.name, 'es'));
    return {
      groups: views,
      comparison: contrastComparison(plan, logs, config.contrast),
      minReviewsPerArm: config.contrast.minReviewsPerArm,
      retentionMinDays: config.contrast.retentionMinDays,
    };
  });

/** LD10: nombre de cada grupo, para el aviso del set en la sesión. */
export const useContrastNames = (): ReadonlyMap<string, string> | undefined =>
  useLiveQuery(
    async () => new Map((await alive(db.contrastGroups.toCollection()).toArray()).map((g) => [g.id, g.name])),
  );

export const useContrastGroup = (id: string | undefined): ContrastGroup | null | undefined =>
  useLiveQuery(async () => {
    if (!id) return null;
    const group = await db.contrastGroups.get(id);
    return group?.deletedAt === null ? group : null;
  }, [id]);

export interface NoteChoice {
  readonly id: string;
  readonly label: string;
  readonly deck: string;
  /** Pregunta y mazo normalizados (acentos, mayúsculas) para buscar. */
  readonly search: string;
}

/** Las notas vivas que se pueden agrupar, por mazo y en orden de creación. */
export const useNoteChoices = (): readonly NoteChoice[] | undefined =>
  useLiveQuery(async () => {
    const [notes, decks] = await Promise.all([
      alive(db.notes.toCollection()).toArray(),
      alive(db.decks.toCollection()).toArray(),
    ]);
    const deckName = new Map(decks.map((d) => [d.id, d.name]));
    return notes
      .filter((n) => deckName.has(n.deckId))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((note) => {
        const label = noteLabel(note);
        const deck = deckName.get(note.deckId) ?? '';
        return { id: note.id, label, deck, search: normalizeAnswer(`${label} ${deck}`) };
      });
  });
