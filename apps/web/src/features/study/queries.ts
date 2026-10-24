import {
  cardFaces,
  DAY_MS,
  localDayBounds,
  type MinuteRange,
  type NoteContent,
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
  fewerNewProposal,
  finalReviewQueue,
  type PlannerCard,
  type SessionPlan,
  type SessionSummary,
  sessionSummary,
  upcomingExamTopics,
} from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { readPlannerCards } from '@/db/planner-cards';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readContrastPlan } from '@/features/contrast';
import { readNotificationPrefs, readProfile, readStudyConfig } from '@/db/settings';

export interface PlanSnapshot {
  readonly plan: SessionPlan;
  readonly config: StudyConfig;
  readonly profile: ProfileSettings;
  /** P3: notas con tarjetas para reformular, la lista "Para mejorar" (§5). */
  readonly toImprove: readonly { readonly noteId: string; readonly prompt: string }[];
  /** Tarjetas vivas con su estado y tema, de donde salió la cola. */
  readonly cards: readonly PlannerCard[];
  /** Mazos en pausa, que Hoy deja fuera. */
  readonly pausedDecks: number;
  /** P3: tope de nuevas que se le propone si la retención baja persistió; nunca se aplica solo. */
  readonly fewerNew: number | null;
}

/**
 * ARC2: la cola la arma `srs`; aquí solo se juntan sus datos desde Dexie (ARC3). Hoy deja
 * fuera los mazos en pausa. Con `deckId`, P1-P8 se aplican solo a las tarjetas de ese mazo,
 * aunque esté en pausa (ella lo eligió); los tiempos (P1) y la retención (P3) siguen saliendo
 * de todo su historial, porque son de ella y no del mazo. `includePaused`: todas (exámenes).
 */
export async function loadPlan(
  database: EstudioDb,
  now: number,
  {
    plannedBlocks,
    deckId,
    tagId,
    includePaused = false,
  }: {
    readonly plannedBlocks?: number;
    readonly deckId?: string;
    readonly tagId?: string;
    readonly includePaused?: boolean;
  } = {},
): Promise<PlanSnapshot> {
  const [config, profile, all, exams] = await Promise.all([
    readStudyConfig(database),
    readProfile(database),
    readPlannerCards(database),
    alive(database.exams.toCollection()).toArray(),
  ]);
  const { notes } = all;
  const plannerCards =
    deckId !== undefined
      ? all.cards.filter((c) => c.deckId === deckId)
      : tagId !== undefined
        ? all.cards.filter((c) => c.tagIds.includes(tagId))
        : includePaused
          ? all.cards
          : all.cards.filter((c) => !c.deckPaused);
  const pausedDecks = all.pausedDeckIds.size;
  const contrast = await readContrastPlan(database, plannerCards); // R9, LD10
  const plan = buildSessionQueue({
    cards: plannerCards,
    logs: await database.reviewLogs.toArray(),
    config,
    scheduler: createScheduler(config.fsrs),
    now,
    timeZone: profile.timeZone,
    plannedBlocks,
    contrastGroups: contrast.groups,
    examTopics: upcomingExamTopics(exams, now, profile.timeZone), // R11
  });
  const noteOf = new Map(plannerCards.map((c) => [c.state.cardId, c.noteId]));
  const leechNotes = new Set(plan.reformulate.flatMap((id) => noteOf.get(id) ?? []));
  const toImprove = [...leechNotes].flatMap((noteId) => {
    const note = notes.get(noteId);
    return note ? [{ noteId, prompt: cardFaces(note.content, 0).prompt }] : [];
  });
  const fewerNew = fewerNewProposal(plan, profile.fewerNewAnsweredAt, now, profile.timeZone, config.planner);
  return { plan, config, profile, toImprove, cards: plannerCards, pausedDecks, fewerNew };
}

/** Plan para empezar una sesión ahora (una sola lectura: la cola queda fija, §3). */
export const planSessionNow = (): Promise<PlanSnapshot> => loadPlan(db, Date.now());

/** Estudiar un solo mazo: el plan de `loadPlan` acotado a él, con su nombre para el título. */
export async function loadDeckPlan(
  database: EstudioDb,
  deckId: string,
  now: number,
): Promise<PlanSnapshot & { readonly scopeName: string }> {
  const deck = await database.decks.get(deckId);
  if (deck?.deletedAt !== null) throw new Error('deck_not_found');
  return { ...(await loadPlan(database, now, { deckId })), scopeName: deck.name };
}

export const planDeckNow = (deckId: string) => loadDeckPlan(db, deckId, Date.now());

/**
 * Estudiar una etiqueta (diseño), como un mazo: P1-P8 solo sobre sus tarjetas, de cualquier
 * mazo y aunque esté en pausa (ella eligió ese alcance); tiempos y retención, de todo su historial.
 */
export async function loadTagPlan(
  database: EstudioDb,
  tagId: string,
  now: number,
): Promise<PlanSnapshot & { readonly scopeName: string }> {
  const tag = await database.tags.get(tagId);
  if (tag?.deletedAt !== null) throw new Error('tag_not_found');
  return { ...(await loadPlan(database, now, { tagId })), scopeName: tag.name };
}

export const planTagNow = (tagId: string) => loadTagPlan(db, tagId, Date.now());

/**
 * LD12: la vuelta de repaso previa al examen. Usa el mismo plan (tiempos, retención) con la
 * cola de `finalReviewQueue`: lo del alcance que FSRS programó para después del examen.
 */
export async function loadExamReviewPlan(
  database: EstudioDb,
  examId: string,
  now: number,
): Promise<PlanSnapshot> {
  // El alcance del examen lo eligió ella: entran sus temas aunque el mazo esté en pausa.
  const snapshot = await loadPlan(database, now, { includePaused: true });
  const exam = await database.exams.get(examId);
  if (exam?.deletedAt !== null) throw new Error('exam_not_found');
  const alive = new Set(
    (await database.topics.bulkGet(exam.topicIds)).flatMap((t) => (t?.deletedAt === null ? [t.id] : [])),
  );
  const queue = finalReviewQueue(
    { date: exam.date, topicIds: exam.topicIds.filter((id) => alive.has(id)) },
    snapshot.cards,
    createScheduler(snapshot.config.fsrs),
    now,
    snapshot.profile.timeZone,
    snapshot.config,
  );
  return { ...snapshot, plan: { ...snapshot.plan, queue, newBlockedBy: null, backlogSpreadDays: null } };
}

export const planExamReviewNow = (examId: string): Promise<PlanSnapshot> =>
  loadExamReviewPlan(db, examId, Date.now());

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

export interface SessionSummaryView {
  readonly summary: SessionSummary;
  /** UX9: el resumen respeta las métricas que ella ocultó. */
  readonly visible: StudyConfig['metrics']['visible'];
  readonly target: number;
}

/** §3: lo del resumen final de la sesión; `now` fija su día local. */
export const useSessionSummary = (
  sessionId: string,
  startedAt: number,
  now: number,
): SessionSummaryView | undefined =>
  useLiveQuery(async () => {
    const [config, profile] = await Promise.all([readStudyConfig(db), readProfile(db)]);
    const since = Math.min(startedAt, localDayBounds(now, profile.timeZone).start);
    const logs = await db.reviewLogs.where('reviewedAt').aboveOrEqual(since).toArray();
    return {
      summary: sessionSummary(logs, sessionId, now, profile.timeZone, config.metrics),
      visible: config.metrics.visible,
      target: config.fsrs.requestRetention,
    };
  }, [sessionId, startedAt, now]);

export interface StudyCardView {
  readonly cardId: string;
  /** El contenido completo: cada tipo se muestra con su propio control (LD §1). */
  readonly content: NoteContent;
  readonly ordinal: number;
  readonly prompt: string;
  /** Solo se monta en el DOM tras el intento (FE10, R1). */
  readonly answer: string;
  readonly explanation: string;
  /** R14: su mnemotecnia, si la escribió; como la respuesta, solo tras el intento (R1). */
  readonly mnemonic: string | null;
}

export const useStudyCard = (cardId: string | null): StudyCardView | null | undefined =>
  useLiveQuery(async () => {
    if (!cardId) return null;
    const card = await db.cards.get(cardId);
    const note = card?.deletedAt === null ? await db.notes.get(card.noteId) : undefined;
    if (!card || note?.deletedAt !== null) return null;
    return {
      cardId,
      content: note.content,
      ordinal: card.ordinal,
      ...cardFaces(note.content, card.ordinal),
      explanation: note.content.explanation,
      mnemonic: note.mnemonic,
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
