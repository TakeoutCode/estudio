import { DAY_MS, type Exam, localDateOf } from '@estudio/shared';
import { type MockResult, mockResults, type WeeklyMetricsInput } from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { readPausedDeckIds } from '@/db/planner-cards';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';

/** Pendientes de hoy y los días que siguen: una semana. */
const FORECAST_DAYS = 7;

/**
 * §5: lo que el worker necesita para el resumen semanal, leído de Dexie (ARC3). Solo
 * tarjetas vivas de notas vivas con estado guardado (las nuevas no son "pendientes"), y sin
 * los mazos en pausa, como Hoy. El historial (retención, tiempo) es completo.
 */
export async function loadMetricsInput(
  database: EstudioDb = db,
  now: number = Date.now(),
): Promise<WeeklyMetricsInput> {
  const [config, profile, paused] = await Promise.all([
    readStudyConfig(database),
    readProfile(database),
    readPausedDeckIds(database),
  ]);
  const notes = new Set(
    (await alive(database.notes.toCollection()).toArray())
      .filter((n) => !paused.has(n.deckId))
      .map((n) => n.id),
  );
  const cards = (await alive(database.cards.toCollection()).toArray()).filter((c) => notes.has(c.noteId));
  const states = await database.cardStates.bulkGet(cards.map((c) => c.id));
  // §5: el sueño solo si ella lo registra; basta la semana y su línea base (srs recorta).
  const sleepSince = localDateOf(now - (config.metrics.baselineWeeks + 2) * 7 * DAY_MS, profile.timeZone);
  const sleepLogs = config.metrics.visible.sleep
    ? await alive(database.sleepLogs.where('date').aboveOrEqual(sleepSince)).toArray()
    : [];
  return {
    logs: await database.reviewLogs.toArray(),
    sleepLogs,
    cards: cards.flatMap((card, i) => {
      const state = states[i];
      return state ? [{ state, lapseBaseline: card.lapseBaseline }] : [];
    }),
    config,
    now,
    timeZone: profile.timeZone,
    forecastDays: FORECAST_DAYS,
  };
}

/** Se vuelve a leer cuando cambian sus datos (p. ej. tras un pull). */
export const useMetricsInput = (): WeeklyMetricsInput | undefined =>
  useLiveQuery(() => loadMetricsInput(db), []);

export interface MockSummary {
  readonly exam: Exam;
  readonly takenAt: number;
  readonly result: MockResult;
}

export interface MockSummaries {
  /** Del simulacro más reciente al más viejo. */
  readonly items: readonly MockSummary[];
  /** Nombres de tema, también de los borrados: el simulacro los usó. */
  readonly topics: ReadonlyMap<string, string>;
}

/**
 * §5 (simulacros): el último simulacro terminado de cada examen vivo, por tema y con la
 * tendencia frente al anterior del mismo examen (`mockResults` de srs, como al terminarlo).
 */
export async function loadMockSummaries(database: EstudioDb = db): Promise<MockSummaries> {
  // Una sola espera: liveQuery observa lo leído antes del primer `await`.
  const [config, exams, sessions, topics] = await Promise.all([
    readStudyConfig(database),
    alive(database.exams.toCollection()).toArray(),
    alive(database.studySessions.toCollection()).toArray(),
    database.topics.toArray(),
  ]);
  const items = exams.flatMap((exam) => {
    const [last, previous] = sessions
      .filter((s) => s.examId === exam.id && s.finishedAt !== null)
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    if (!last?.finishedAt) return [];
    return [
      { exam, takenAt: last.finishedAt, result: mockResults(last.items, previous?.items ?? null, config) },
    ];
  });
  return {
    items: items.sort((a, b) => b.takenAt - a.takenAt),
    topics: new Map(topics.map((t) => [t.id, t.name])),
  };
}

export const useMockSummaries = (): MockSummaries | undefined =>
  useLiveQuery(() => loadMockSummaries(db), []);
