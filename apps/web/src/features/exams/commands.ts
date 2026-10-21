import {
  type Confidence,
  type Exam,
  ExamSchema,
  isExerciseKind,
  newId,
  ReviewLogSchema,
  type StudySession,
  StudySessionSchema,
} from '@estudio/shared';
import { buildMock, toRating } from '@estudio/srs';
import { deviceId, hlcWall, nextHlc } from '@/db/clock';
import { projectCards } from '@/db/projection';
import { alive, db as defaultDb, type EstudioDb } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/** R11: título, fecha (inicio de su día local, AG6) y temas que entran (LD11). */
export interface ExamInput {
  readonly title: string;
  readonly date: number;
  readonly topicIds: readonly string[];
}

/** FRONTEND FE3: la fila, el HLC y el outbox en una transacción; nada se escribe si no valida. */
async function saveExam(
  database: EstudioDb,
  now: number,
  build: (stamp: { hlc: string; updatedAt: number }) => Promise<unknown>,
): Promise<Exam> {
  const exam = await database.transaction(
    'rw',
    [database.exams, database.outbox, database.meta],
    async () => {
      const hlc = await nextHlc(database, now);
      const row = ExamSchema.parse(await build({ hlc, updatedAt: hlcWall(hlc) }));
      await writeAndQueue(database, 'exam', row, now);
      return row;
    },
  );
  syncScheduler.poke();
  return exam;
}

export function createExam(
  input: ExamInput,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
) {
  return saveExam(database, now, (stamp) =>
    Promise.resolve({ id: newId(), ...input, topicIds: [...input.topicIds], deletedAt: null, ...stamp }),
  );
}

export function updateExam(
  id: string,
  input: ExamInput,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
) {
  return saveExam(database, now, async (stamp) => ({
    ...(await existing(database, id)),
    ...input,
    topicIds: [...input.topicIds],
    ...stamp,
  }));
}

/** Borrado lógico (SYNC §6). */
export function deleteExam(id: string, { database = defaultDb, now = Date.now() }: CommandOptions = {}) {
  return saveExam(database, now, async (stamp) => ({
    ...(await existing(database, id)),
    ...stamp,
    deletedAt: stamp.updatedAt,
  }));
}

async function existing(database: EstudioDb, id: string): Promise<Exam> {
  const exam = await database.exams.get(id);
  if (exam?.deletedAt !== null) throw new Error('exam_not_found');
  return exam;
}

/** No hay tarjetas empezadas de los temas del examen: no hay qué examinar todavía. */
export class NoMockQuestionsError extends Error {
  constructor() {
    super('no_mock_questions');
  }
}

const mockTables = (database: EstudioDb) => [
  database.exams,
  database.topics,
  database.notes,
  database.cards,
  database.cardStates,
  database.reviewLogs,
  database.userSettings,
  database.studySessions,
  database.outbox,
  database.meta,
];

async function writeSession(database: EstudioDb, row: StudySession, now: number): Promise<StudySession> {
  const hlc = await nextHlc(database, now);
  const saved = StudySessionSchema.parse({ ...row, hlc, updatedAt: hlcWall(hlc) });
  await writeAndQueue(database, 'studySession', saved, now);
  return saved;
}

/**
 * P7, LD13: arma el simulacro con `buildMock` (semilla = id de la sesión, AG3) y lo guarda
 * como StudySession, así se puede retomar. La retroalimentación queda fija al empezar.
 */
export async function startMock(
  examId: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<StudySession> {
  const session = await database.transaction('rw', mockTables(database), async () => {
    const exam = await existing(database, examId);
    const config = await readStudyConfig(database);
    const others = (await alive(database.exams.toCollection()).toArray()).filter((e) => e.id !== exam.id);
    // Los ejercicios (LD §2) todavía no entran: el simulacro muestra cada pregunta como texto.
    const notes = new Map(
      (await alive(database.notes.toCollection()).toArray())
        .filter((n) => !isExerciseKind(n.content.kind))
        .map((n) => [n.id, n]),
    );
    const cards = (await alive(database.cards.toCollection()).toArray()).filter((c) => notes.has(c.noteId));
    const states = await database.cardStates.bulkGet(cards.map((c) => c.id));
    const id = newId();
    const questions = buildMock({
      exam,
      otherExams: others,
      cards: cards.flatMap((card, i) => {
        const state = states[i];
        return state ? [{ state, topicId: notes.get(card.noteId)?.topicId ?? null }] : [];
      }),
      cfg: config.exam,
      seed: id,
    });
    if (questions.length === 0) throw new NoMockQuestionsError();
    return writeSession(
      database,
      {
        id,
        mode: 'exam',
        examId: exam.id,
        feedbackTiming: config.exam.feedbackTiming,
        items: questions.map((q) => ({
          ...q,
          confidence: null,
          answer: null,
          durationMs: null,
          answeredAt: null,
          correct: null,
        })),
        startedAt: now,
        finishedAt: null,
        hlc: '',
        updatedAt: now,
        deletedAt: null,
      },
      now,
    );
  });
  syncScheduler.poke();
  return session;
}

/** R6 y R3: la confianza (obligatoria) y lo que escribió quedan guardados al responder. */
export async function answerMockItem(
  sessionId: string,
  index: number,
  input: { readonly confidence: Confidence; readonly answer: string; readonly durationMs: number },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<StudySession> {
  const saved = await database.transaction('rw', mockTables(database), async () => {
    const session = await activeSession(database, sessionId);
    const answer = input.answer.trim();
    const items = session.items.map((item, i) =>
      i === index
        ? {
            ...item,
            confidence: input.confidence,
            answer: answer === '' ? null : answer,
            durationMs: Math.max(0, Math.round(input.durationMs)),
            answeredAt: now,
          }
        : item,
    );
    return writeSession(database, { ...session, items }, now);
  });
  syncScheduler.poke();
  return saved;
}

/**
 * P7, LD2: ella marca si acertó al ver la respuesta. Se escribe el ReviewLog `exam` con
 * `toRating` (acierto con confianza alta = Good; con poca = Hard; fallo = Again) y, si
 * `affectsScheduling`, FSRS lo cuenta al reproyectar (ADR-009). Al calificar la última,
 * el simulacro termina.
 */
export async function gradeMockItem(
  sessionId: string,
  index: number,
  correct: boolean,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<StudySession> {
  const saved = await database.transaction('rw', mockTables(database), async () => {
    const session = await activeSession(database, sessionId);
    const item = session.items[index];
    if (!item?.confidence || item.answeredAt === null || item.correct !== null)
      throw new Error('mock_item_not_ready');
    const config = await readStudyConfig(database);
    const card = await database.cards.get(item.cardId);
    const note = card ? await database.notes.get(card.noteId) : undefined;
    const log = ReviewLogSchema.parse({
      id: newId(),
      cardId: item.cardId,
      cardKind: note?.content.kind ?? 'basic',
      reviewedAt: item.answeredAt, // el intento fue al responder, aunque se califique después
      rating: toRating({ kind: 'exam', correct, confidence: item.confidence }, config),
      durationMs: item.durationMs ?? 0,
      type: 'exam',
      confidence: item.confidence,
      sessionId: session.id,
      deviceId: await deviceId(database),
      ...(item.answer ? { answer: { text: item.answer } } : {}),
    });
    await writeAndQueue(database, 'reviewLog', log, now);
    await projectCards(database, [item.cardId]);
    const items = session.items.map((it, i) => (i === index ? { ...it, correct } : it));
    const finished = items.every((it) => it.correct !== null);
    return writeSession(database, { ...session, items, finishedAt: finished ? now : null }, now);
  });
  syncScheduler.poke();
  return saved;
}

async function activeSession(database: EstudioDb, id: string): Promise<StudySession> {
  const session = await database.studySessions.get(id);
  if (session?.deletedAt !== null || session.finishedAt !== null) throw new Error('mock_not_active');
  return session;
}
