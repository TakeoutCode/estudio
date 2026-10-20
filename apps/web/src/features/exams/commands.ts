import { type Exam, ExamSchema, newId } from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
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
