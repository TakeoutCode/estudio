import { localDayBounds, Rating, type ReviewLog, type StudyConfig } from '@estudio/shared';
import { logsByCard, type ReplayCard } from '../fsrs/replay-cards.js';
import {
  type CardState,
  createScheduler,
  newCardState,
  replay,
  reviewTypeFor,
  type Scheduler,
} from '../fsrs/scheduler.js';
import { isLeech, type PlannerCard } from './queue.js';

// Carga proyectada (STUDY-METHODS R2, LEARNING-DESIGN LD8): "más retención = más repasos al
// día", calculada con `replay()` y días simulados. Es una estimación para decidir, no un plan:
// no cambia fechas de FSRS (§3).

export interface LoadCard extends ReplayCard {
  /** Lapsos que ya tenía al reformularla (P3). */
  readonly lapseBaseline: number;
}

export interface ReviewLoadInput {
  /** Tarjetas vivas (sin `deletedAt`). */
  readonly cards: readonly LoadCard[];
  readonly logs: readonly ReviewLog[];
  /** La retención a evaluar va en `fsrs.requestRetention`. */
  readonly config: StudyConfig;
  readonly now: number;
  /** Los días simulados son días locales de ella (AG6). */
  readonly timeZone: string;
}

export interface ReviewLoad {
  readonly requestRetention: number;
  readonly days: number;
  /** Repasos de tarjetas ya aprendidas por día, en promedio. */
  readonly reviewsPerDay: number;
}

/** R2 y LD8: reproduce el log de cada tarjeta con la retención de `config` y simula los días. */
export function projectReviewLoad(input: ReviewLoadInput): ReviewLoad {
  const scheduler = createScheduler(input.config.fsrs);
  const byCard = logsByCard(input.logs);
  return simulateReviewLoad({
    cards: input.cards.map((card) => ({
      state: replay(
        scheduler,
        newCardState(card.cardId, card.createdAt),
        byCard.get(card.cardId) ?? [],
        input.config.exam,
      ),
      lapseBaseline: card.lapseBaseline,
    })),
    scheduler,
    config: input.config,
    now: input.now,
    timeZone: input.timeZone,
  });
}

export interface SimulationInput {
  readonly cards: readonly Pick<PlannerCard, 'state' | 'lapseBaseline'>[];
  /** Con la retención a evaluar. */
  readonly scheduler: Scheduler;
  readonly config: StudyConfig;
  readonly now: number;
  readonly timeZone: string;
}

/**
 * Simula `fsrs.projectionDays` días locales, de `now` al fin del último (hoy cuenta desde
 * `now`). Supuestos (diseño · sin evidencia):
 * - cada tarjeta se repasa al vencer; lo pendiente, hoy;
 * - en un repaso la recuerda con la probabilidad que da FSRS (retrievability). El sorteo usa
 *   una semilla del id y del número de repasos, sin azar propio (AG3), y es el mismo con
 *   cualquier retención, así la diferencia entre dos valores sale de la retención y no del azar;
 * - las nuevas entran hasta `planner.newPerSessionMax` por día (una sesión al día) en orden de
 *   creación, y los pasos de aprendizaje y reaprendizaje se dan por bien;
 * - las de "reformular" (P3) no se repiten, igual que en la cola.
 * Cuenta los repasos de tarjetas ya aprendidas (tipo `review`, §5); el aprendizaje de las
 * nuevas casi no depende de la retención.
 */
export function simulateReviewLoad(input: SimulationInput): ReviewLoad {
  const { config, scheduler, now, timeZone } = input;
  const days = config.fsrs.projectionDays;
  const dayStarts = [now];
  let horizon = localDayBounds(now, timeZone).end;
  for (let day = 1; day < days; day += 1) {
    dayStarts.push(horizon);
    horizon = localDayBounds(horizon, timeZone).end;
  }

  const active = input.cards.filter((card) => !isLeech(card, config.planner));
  const fresh = active
    .filter((card) => card.state.phase === 'new')
    .sort((a, b) => a.state.due - b.state.due || compareIds(a.state.cardId, b.state.cardId));
  const perDay = config.planner.newPerSessionMax;

  let reviews = 0;
  for (const card of active) {
    if (card.state.phase !== 'new') reviews += reviewsUntil(scheduler, card.state, now, horizon);
  }
  fresh.forEach((card, i) => {
    const day = perDay === 0 ? days : Math.floor(i / perDay);
    const enters = dayStarts[day];
    if (enters !== undefined) reviews += reviewsUntil(scheduler, card.state, enters, horizon);
  });

  return { requestRetention: config.fsrs.requestRetention, days, reviewsPerDay: reviews / days };
}

/** Repasos `review` de una tarjeta desde `from` hasta `horizon` (exclusivo). */
function reviewsUntil(scheduler: Scheduler, initial: CardState, from: number, horizon: number): number {
  let state = initial;
  let count = 0;
  // Termina: cada repaso deja `due` después de `at`, y "bien" saca a la tarjeta del
  // (re)aprendizaje con un intervalo de días.
  for (let at = Math.max(state.due, from); at < horizon; at = Math.max(state.due, from)) {
    const recalled =
      state.phase !== 'review' ||
      unitHash(`${state.cardId}:${String(state.reps)}`) < scheduler.retrievability(state, at);
    if (reviewTypeFor(state.phase) === 'review') count += 1;
    state = scheduler.apply(state, { reviewedAt: at, rating: recalled ? Rating.Good : Rating.Again });
  }
  return count;
}

// FNV-1a de 32 bits con el mezclado final de MurmurHash3: un número en [0, 1) que depende
// solo del texto (no son umbrales de estudio).
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32 = 0x1_0000_0000;

function unitHash(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / UINT32;
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
