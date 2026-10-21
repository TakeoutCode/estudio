import {
  cardFaces,
  type Deck,
  type Exam,
  type ImageOcclusionContent,
  type StudyConfig,
  type StudySession,
  type Topic,
} from '@estudio/shared';
import {
  createScheduler,
  type ExamPlan,
  examPlan,
  finalReviewQueue,
  mockResults,
  mocksDue,
  mockTaken,
  newCardState,
  type PlannerCard,
} from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';

export interface ExamsOverview {
  /** Por fecha, del más próximo al más lejano. */
  readonly exams: readonly Exam[];
  readonly plans: ReadonlyMap<string, ExamPlan>;
  readonly topics: ReadonlyMap<string, Topic>;
  /** P7, LD13: simulacros de cada examen. */
  readonly mocks: ReadonlyMap<string, ExamMocks>;
  /** LD12: tarjetas del repaso previo de cada examen (0 fuera de la ventana). */
  readonly finalReviews: ReadonlyMap<string, number>;
  readonly config: StudyConfig;
  readonly timeZone: string;
}

export interface ExamMocks {
  /** Simulacros que corresponden esta semana (P7); 0 si no hace falta. */
  readonly due: number;
  readonly inProgress: boolean;
  /** Último terminado: aciertos sobre calificadas. */
  readonly last: { readonly graded: number; readonly correct: number } | null;
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
    // Los temas borrados ya no cuentan en el alcance.
    const scopeOf = (exam: Exam) => ({ ...exam, topicIds: exam.topicIds.filter((id) => topics.has(id)) });
    const plans = new Map(
      exams.map(
        (exam) => [exam.id, examPlan(scopeOf(exam), plannerCards, now, profile.timeZone, config)] as const,
      ),
    );
    const scheduler = createScheduler(config.fsrs);
    const finalReviews = new Map(
      exams.map(
        (exam) =>
          [
            exam.id,
            finalReviewQueue(scopeOf(exam), plannerCards, scheduler, now, profile.timeZone, config).length,
          ] as const,
      ),
    );
    const sessions = await alive(db.studySessions.toCollection()).toArray();
    const due = mocksDue(
      exams.map((e) => ({ examId: e.id, date: e.date })),
      sessions.flatMap((s) => mockTaken(s) ?? []),
      now,
      config.exam,
    );
    const mocks = new Map(
      exams.map((exam) => {
        const own = sessions.filter((s) => s.examId === exam.id).sort((a, b) => b.startedAt - a.startedAt);
        const finished = own.find((s) => s.finishedAt !== null);
        const result = finished ? mockResults(finished.items, null, config) : null;
        return [
          exam.id,
          {
            due: due.find((d) => d.examId === exam.id)?.missing ?? 0,
            inProgress: own.some((s) => s.finishedAt === null),
            last: result ? { graded: result.graded, correct: result.correct } : null,
          },
        ] as const;
      }),
    );
    return { exams, plans, topics, mocks, finalReviews, config, timeZone: profile.timeZone };
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

export interface MockCardView {
  readonly prompt: string;
  /** Solo se monta al revisar (R1, FE10). */
  readonly answer: string;
  readonly explanation: string;
  /** R10: la imagen con la etiqueta que se pregunta, si es una oclusión. */
  readonly occlusion: { readonly content: ImageOcclusionContent; readonly ordinal: number } | null;
}

export interface MockView {
  readonly exam: Exam;
  /** Simulacro en curso, si hay. */
  readonly active: StudySession | null;
  /** Último terminado y el anterior (tendencia, §5). */
  readonly last: StudySession | null;
  readonly previous: StudySession | null;
  readonly cards: ReadonlyMap<string, MockCardView>;
  readonly topics: ReadonlyMap<string, string>;
  readonly config: StudyConfig;
}

/** P7, LD13: el simulacro de un examen; `null` si el examen no existe. */
export const useMockView = (examId: string | undefined): MockView | null | undefined =>
  useLiveQuery(async () => {
    const exam = examId ? await db.exams.get(examId) : undefined;
    if (exam?.deletedAt !== null) return null;
    const config = await readStudyConfig(db);
    const sessions = (await alive(db.studySessions.where('examId').equals(exam.id)).toArray()).sort(
      (a, b) => b.startedAt - a.startedAt,
    );
    const active = sessions.find((s) => s.finishedAt === null) ?? null;
    const [last = null, previous = null] = sessions.filter((s) => s.finishedAt !== null);
    const cardIds = [...new Set([active, last].flatMap((s) => s?.items.map((i) => i.cardId) ?? []))];
    const cards = new Map<string, MockCardView>();
    for (const card of await db.cards.bulkGet(cardIds)) {
      const note = card ? await db.notes.get(card.noteId) : undefined;
      if (card && note)
        cards.set(card.id, {
          ...cardFaces(note.content, card.ordinal),
          explanation: note.content.explanation,
          occlusion:
            note.content.kind === 'image_occlusion' ? { content: note.content, ordinal: card.ordinal } : null,
        });
    }
    const topics = new Map((await db.topics.toArray()).map((t) => [t.id, t.name]));
    return { exam, active, last, previous, cards, topics, config };
  }, [examId]);
