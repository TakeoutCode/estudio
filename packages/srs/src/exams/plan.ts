import { type Exam, localDayNumber, type StudyConfig } from '@estudio/shared';
import { isLeech, type PlannerCard } from '../planner/queue.js';

// Plan hacia la fecha de cada examen (STUDY-METHODS R11; LEARNING-DESIGN LD11, LD12). Solo
// sugiere: no cambia fechas de FSRS (§3) ni la cola por su cuenta.

export interface ExamTopicPlan {
  readonly topicId: string;
  /** Nuevas que faltan por aprender (sin las de "reformular", P3). */
  readonly newRemaining: number;
  /** Ya aprendidas o en aprendizaje. */
  readonly started: number;
}

export interface ExamPlan {
  readonly examId: string;
  /** Días locales de estudio antes del día del examen; hoy cuenta (AG6). */
  readonly daysLeft: number;
  /** El día del examen ya pasó. */
  readonly past: boolean;
  readonly topics: readonly ExamTopicPlan[];
  readonly newRemaining: number;
  /** LD11: ⌈faltan / días⌉ por día, limitado por P1 (`newPerSessionMax`). */
  readonly suggestedNewPerDay: number;
  /** Nuevas que no alcanzan a entrar antes del examen con ese tope (para decirlo sin alarma). */
  readonly beyondCap: number;
  /** LD12: está en los últimos `finalReviewWindowDays` días. */
  readonly inFinalWindow: boolean;
}

export function examPlan(
  exam: Pick<Exam, 'id' | 'date' | 'topicIds'>,
  cards: readonly Pick<PlannerCard, 'state' | 'topicId' | 'lapseBaseline'>[],
  now: number,
  timeZone: string,
  cfg: Pick<StudyConfig, 'planner' | 'exam'>,
): ExamPlan {
  const until = localDayNumber(exam.date, timeZone) - localDayNumber(now, timeZone);
  const daysLeft = Math.max(0, until);
  const topics = exam.topicIds.map((topicId) => {
    const inTopic = cards.filter((c) => c.topicId === topicId && !isLeech(c, cfg.planner));
    const newRemaining = inTopic.filter((c) => c.state.phase === 'new').length;
    return { topicId, newRemaining, started: inTopic.length - newRemaining };
  });
  const newRemaining = topics.reduce((sum, t) => sum + t.newRemaining, 0);
  const cap = cfg.planner.newPerSessionMax;
  return {
    examId: exam.id,
    daysLeft,
    past: until < 0,
    topics,
    newRemaining,
    suggestedNewPerDay: daysLeft === 0 ? 0 : Math.min(cap, Math.ceil(newRemaining / daysLeft)),
    beyondCap: Math.max(0, newRemaining - cap * daysLeft),
    inFinalWindow: until >= 0 && until < cfg.exam.finalReviewWindowDays,
  };
}

/**
 * R11: los temas de los exámenes que vienen, del más próximo al más lejano y sin repetir. La cola
 * pone primero las nuevas de estos temas (`buildSessionQueue`); los que ya pasaron no cuentan.
 */
export function upcomingExamTopics(
  exams: readonly Pick<Exam, 'date' | 'topicIds'>[],
  now: number,
  timeZone: string,
): string[] {
  const today = localDayNumber(now, timeZone);
  const upcoming = exams
    .filter((exam) => localDayNumber(exam.date, timeZone) >= today)
    .sort((a, b) => a.date - b.date);
  return [...new Set(upcoming.flatMap((exam) => exam.topicIds))];
}
