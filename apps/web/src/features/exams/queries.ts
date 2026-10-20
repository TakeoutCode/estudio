import type { Deck, Exam, StudyConfig, Topic } from '@estudio/shared';
import { type ExamPlan, examPlan, newCardState, type PlannerCard } from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';

export interface ExamsOverview {
  /** Por fecha, del más próximo al más lejano. */
  readonly exams: readonly Exam[];
  readonly plans: ReadonlyMap<string, ExamPlan>;
  readonly topics: ReadonlyMap<string, Topic>;
  readonly config: StudyConfig;
  readonly timeZone: string;
}

/** R11, LD11: los exámenes con su plan, recalculado cuando cambian sus datos. */
export const useExamsOverview = (): ExamsOverview | undefined =>
  useLiveQuery(async () => {
    const now = Date.now();
    const [config, profile] = await Promise.all([readStudyConfig(db), readProfile(db)]);
    const exams = await alive(db.exams.orderBy('date')).toArray();
    const topics = new Map((await alive(db.topics.toCollection()).toArray()).map((t) => [t.id, t]));
    const notes = new Map((await alive(db.notes.toCollection()).toArray()).map((n) => [n.id, n]));
    const cards = (await alive(db.cards.toCollection()).toArray()).filter((c) => notes.has(c.noteId));
    const states = await db.cardStates.bulkGet(cards.map((c) => c.id));
    const plannerCards: PlannerCard[] = cards.map((card, i) => ({
      state: states[i] ?? newCardState(card.id, card.createdAt),
      topicId: notes.get(card.noteId)?.topicId ?? null,
      lapseBaseline: card.lapseBaseline,
    }));
    const plans = new Map(
      exams.map((exam) => {
        // Los temas borrados ya no cuentan en el alcance.
        const scope = { ...exam, topicIds: exam.topicIds.filter((id) => topics.has(id)) };
        return [exam.id, examPlan(scope, plannerCards, now, profile.timeZone, config)] as const;
      }),
    );
    return { exams, plans, topics, config, timeZone: profile.timeZone };
  }, []);

/** El examen a editar; `null` si no existe o está borrado. */
export const useExam = (id: string | undefined): Exam | null | undefined =>
  useLiveQuery(async () => {
    if (!id) return null;
    const exam = await db.exams.get(id);
    return exam?.deletedAt === null ? exam : null;
  }, [id]);

export interface DeckTopics {
  readonly deck: Deck;
  readonly topics: readonly Topic[];
}

/** LD11: los temas vivos agrupados por mazo, para elegir el alcance. */
export const useTopicsByDeck = (): readonly DeckTopics[] | undefined =>
  useLiveQuery(async () => {
    const decks = await alive(db.decks.toCollection()).toArray();
    const topics = await alive(db.topics.toCollection()).toArray();
    return decks
      .map((deck) => ({
        deck,
        topics: topics.filter((t) => t.deckId === deck.id).sort((a, b) => a.name.localeCompare(b.name, 'es')),
      }))
      .filter((group) => group.topics.length > 0)
      .sort((a, b) => a.deck.name.localeCompare(b.deck.name, 'es'));
  }, []);

/** Zona horaria de ella para convertir la fecha del examen (AG6). */
export const useTimeZone = (): string | undefined =>
  useLiveQuery(async () => (await readProfile(db)).timeZone, []);
