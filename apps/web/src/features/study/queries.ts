import {
  cardFaces,
  DAY_MS,
  type MinuteRange,
  type PlannerConfig,
  type ProfileSettings,
  type ReviewLog,
  type StudyConfig,
  type TimerBlockLog,
  type Topic,
} from '@estudio/shared';
import {
  buildSessionQueue,
  type CardState,
  createScheduler,
  newCardState,
  type PlannerCard,
  type SessionPlan,
} from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readNotificationPrefs, readProfile, readStudyConfig } from '@/db/settings';

export interface PlanSnapshot {
  readonly plan: SessionPlan;
  readonly config: StudyConfig;
  readonly profile: ProfileSettings;
  /** P3: notas con tarjetas para reformular, la lista "Para mejorar" (§5). */
  readonly toImprove: readonly { readonly noteId: string; readonly prompt: string }[];
}

/** ARC2: la cola la arma `srs`; aquí solo se juntan sus datos desde Dexie (ARC3). */
export async function loadPlan(
  database: EstudioDb,
  now: number,
  plannedBlocks?: number,
): Promise<PlanSnapshot> {
  const [config, profile] = await Promise.all([readStudyConfig(database), readProfile(database)]);
  const notes = new Map((await alive(database.notes.toCollection()).toArray()).map((n) => [n.id, n]));
  const cards = (await alive(database.cards.toCollection()).toArray()).filter((c) => notes.has(c.noteId));
  const stored = await database.cardStates.bulkGet(cards.map((c) => c.id));
  const plannerCards: PlannerCard[] = cards.map((card, i) => ({
    state: stored[i] ?? newCardState(card.id, card.createdAt),
    topicId: notes.get(card.noteId)?.topicId ?? null,
    lapseBaseline: card.lapseBaseline,
  }));
  const plan = buildSessionQueue({
    cards: plannerCards,
    logs: await database.reviewLogs.toArray(),
    config,
    scheduler: createScheduler(config.fsrs),
    now,
    timeZone: profile.timeZone,
    plannedBlocks,
  });
  const leechNotes = new Set(
    plan.reformulate.map((id) => cards.find((c) => c.id === id)?.noteId).filter((id) => id !== undefined),
  );
  const toImprove = [...leechNotes].flatMap((noteId) => {
    const note = notes.get(noteId);
    return note ? [{ noteId, prompt: cardFaces(note.content, 0).prompt }] : [];
  });
  return { plan, config, profile, toImprove };
}

/** Plan para empezar una sesión ahora (una sola lectura: la cola queda fija, §3). */
export const planSessionNow = (): Promise<PlanSnapshot> => loadPlan(db, Date.now());

/** Resumen de Hoy; se recalcula cuando cambian sus datos (p. ej. tras un pull). */
export const useTodayPlan = (): PlanSnapshot | undefined => useLiveQuery(() => loadPlan(db, Date.now()), []);

/** Estados FSRS de las tarjetas de la cola: solo esas, para no leer toda la base por respuesta (FE9). */
export function useQueueStates(cardIds: readonly string[]): ReadonlyMap<string, CardState> | undefined {
  const key = cardIds.join(',');
  return useLiveQuery(async () => {
    const states = await db.cardStates.bulkGet([...cardIds]);
    return new Map(states.flatMap((s) => (s ? [[s.cardId, s] as const] : [])));
  }, [key]);
}

export interface SessionSignals {
  /** Respuestas de esta sesión (P5). */
  readonly logs: readonly ReviewLog[];
  /** Bloques del temporizador desde un día antes de empezar; `srs` elige los de su día (P6). */
  readonly blocks: readonly TimerBlockLog[];
  readonly profile: ProfileSettings;
  /** Si no declaró hora de dormir, P6 usa el inicio de las horas silenciosas. */
  readonly quietHours: MinuteRange;
  readonly planner: PlannerConfig;
}

/** Lo que P5 y P6 leen durante la sesión; se actualiza con cada respuesta. */
export const useSessionSignals = (sessionId: string, startedAt: number): SessionSignals | undefined =>
  useLiveQuery(async () => {
    const [logs, blocks, profile, prefs, config] = await Promise.all([
      db.reviewLogs
        .where('reviewedAt')
        .aboveOrEqual(startedAt)
        .filter((log) => log.sessionId === sessionId)
        .toArray(),
      db.timerBlockLogs
        .where('endedAt')
        .aboveOrEqual(startedAt - DAY_MS)
        .toArray(),
      readProfile(db),
      readNotificationPrefs(db),
      readStudyConfig(db),
    ]);
    return { logs, blocks, profile, quietHours: prefs.quietHours, planner: config.planner };
  }, [sessionId, startedAt]);

export interface StudyCardView {
  readonly cardId: string;
  readonly cardKind: 'basic';
  readonly prompt: string;
  /** Solo se monta en el DOM tras el intento (FE10, R1). */
  readonly answer: string;
  readonly explanation: string;
}

export const useStudyCard = (cardId: string | null): StudyCardView | null | undefined =>
  useLiveQuery(async () => {
    if (!cardId) return null;
    const card = await db.cards.get(cardId);
    const note = card?.deletedAt === null ? await db.notes.get(card.noteId) : undefined;
    if (!card || note?.deletedAt !== null) return null;
    return {
      cardId,
      cardKind: note.content.kind,
      ...cardFaces(note.content, card.ordinal),
      explanation: note.content.explanation,
    };
  }, [cardId]);

/** LD5: temas que ya tienen una autoexplicación; `undefined` mientras carga. */
export const useExplainedTopics = (): ReadonlySet<string> | undefined =>
  useLiveQuery(async () => {
    const rows = await alive(db.selfExplanations.toCollection()).toArray();
    return new Set(rows.map((row) => row.topicId));
  }, []);

/** LD5, R5: el tema que se presenta antes de su primera tarjeta nueva. */
export const useTopicView = (topicId: string): Topic | null | undefined =>
  useLiveQuery(async () => {
    const topic = await db.topics.get(topicId);
    return topic?.deletedAt === null ? topic : null;
  }, [topicId]);
