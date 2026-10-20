import { localDayBounds, type PlannerConfig, type ReviewLog, type StudyConfig } from '@estudio/shared';
import type { CardState, Scheduler } from '../fsrs/scheduler.js';
import { type RetentionStatus, retentionStatus, sessionTiming, type SessionTiming } from './history.js';

// Cola de la sesión (STUDY-METHODS §3 "Integración con FSRS" y §4 P1-P4, P8). La cola no
// cambia fechas de FSRS: solo elige qué vencidas y nuevas entran y en qué orden.

const MINUTE_MS = 60_000;

export interface PlannerCard {
  readonly state: CardState;
  readonly topicId: string | null;
  /** Lapsos que ya tenía al reformularla (P3): solo cuentan los posteriores. */
  readonly lapseBaseline: number;
}

export interface SessionPlanInput {
  /** Tarjetas vivas (sin `deletedAt`). */
  readonly cards: readonly PlannerCard[];
  /** Historial completo: da los tiempos medianos (P1) y la retención reciente (P3). */
  readonly logs: readonly ReviewLog[];
  readonly config: StudyConfig;
  readonly scheduler: Scheduler;
  readonly now: number;
  /** `UserSettings.profile.timeZone`: define "vencidas hoy" y el atraso (AG6). */
  readonly timeZone: string;
  /** Bloques de enfoque planeados (P1); por defecto `planner.sessionBlocksDefault`. */
  readonly plannedBlocks?: number;
}

export interface QueueItem {
  readonly cardId: string;
  readonly topicId: string | null;
  readonly kind: 'review' | 'new';
}

/** Por qué hoy no entran nuevas: P2 (demasiadas vencidas) o P3 (retención baja). */
export type NewCardsBlock = 'overdue' | 'low_retention';

export interface SessionPlan {
  /** Vencidas primero (P2) y luego nuevas. */
  readonly queue: readonly QueueItem[];
  readonly budgetMs: number;
  readonly timing: SessionTiming;
  /** Repasos que caben en el presupuesto. */
  readonly capacity: number;
  /** Vencidas hoy, incluido el atraso: la "carga" de §5 ("pendientes"). */
  readonly due: number;
  /** Vencidas desde antes de hoy. */
  readonly backlog: number;
  /** P8: días en que se reparte el atraso; null si no hace falta repartir. */
  readonly backlogSpreadDays: number | null;
  readonly newBlockedBy: NewCardsBlock | null;
  readonly retention: RetentionStatus;
  /** P3: con ≥ `leechLapses` lapsos van a "reformular" en vez de repetirse. */
  readonly reformulate: readonly string[];
  /** P3: la retención baja persistió; tope de nuevas para proponerle, nunca aplicado solo. */
  readonly proposedNewPerSessionMax: number | null;
}

interface DueCard {
  readonly card: PlannerCard;
  readonly retrievability: number;
}

export function buildSessionQueue(input: SessionPlanInput): SessionPlan {
  const { config: cfg, now, scheduler } = input;
  const p = cfg.planner;
  const budgetMs = (input.plannedBlocks ?? p.sessionBlocksDefault) * cfg.timer.focusMin * MINUTE_MS;
  const timing = sessionTiming(input.logs, p);
  const capacity = Math.floor(budgetMs / timing.reviewMs);
  const today = localDayBounds(now, input.timeZone);

  const reformulate: string[] = [];
  const due: DueCard[] = [];
  const fresh: PlannerCard[] = [];
  for (const card of input.cards) {
    const s = card.state;
    if (isLeech(card, p)) reformulate.push(s.cardId);
    else if (s.phase === 'new') fresh.push(card);
    else if (s.phase === 'review' ? s.due < today.end : s.due <= now) {
      due.push({ card, retrievability: scheduler.retrievability(s, now) });
    }
  }
  // §3: menor retrievability primero; con empate, la más vencida.
  due.sort(
    (a, b) =>
      a.retrievability - b.retrievability ||
      a.card.state.due - b.card.state.due ||
      compareIds(a.card.state.cardId, b.card.state.cardId),
  );

  // P8: si no cabe todo, se limita al presupuesto y el atraso se reparte en 3-7 días.
  const backlog = due.filter((d) => d.card.state.due < today.start).length;
  let reviewQuota = due.length;
  let backlogSpreadDays: number | null = null;
  if (due.length > capacity) {
    const room = capacity - (due.length - backlog);
    reviewQuota = capacity;
    if (backlog > 0 && room > 0) {
      backlogSpreadDays = clamp(Math.ceil(backlog / room), p.backlogSpreadMinDays, p.backlogSpreadMaxDays);
      reviewQuota = Math.min(capacity, due.length - backlog + Math.ceil(backlog / backlogSpreadDays));
    }
  }
  const reviews = limitTopicRuns(
    due.slice(0, reviewQuota).map((d) => item(d.card, 'review')),
    p.reviewMaxSameTopicRun,
  );

  // P2 y P3 bloquean las nuevas; P1 las limita al presupuesto que sobra y al tope.
  const retention = retentionStatus(input.logs, now, input.timeZone, cfg);
  const newBlockedBy: NewCardsBlock | null =
    due.length > p.overdueFactorForZeroNew * capacity
      ? 'overdue'
      : retention.current.low
        ? 'low_retention'
        : null;
  const fits = Math.max(0, Math.floor((budgetMs - reviews.length * timing.reviewMs) / timing.newMs));
  const newCount = newBlockedBy ? 0 : Math.min(p.newPerSessionMax, fits);
  const news = byTopicChunks(fresh, p.newMaxSameTopicRun).slice(0, newCount);

  return {
    queue: [...reviews, ...news],
    budgetMs,
    timing,
    capacity,
    due: due.length,
    backlog,
    backlogSpreadDays,
    newBlockedBy,
    retention,
    reformulate,
    proposedNewPerSessionMax:
      retention.lowStreakDays >= p.lowRetentionPersistDays
        ? Math.floor(p.newPerSessionMax * p.persistNewFactor)
        : null,
  };
}

const item = (card: PlannerCard, kind: QueueItem['kind']): QueueItem => ({
  cardId: card.state.cardId,
  topicId: card.topicId,
  kind,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * P4: repasos mezclados. Respeta el orden salvo cuando una racha llegaría a más de
 * `maxRun` del mismo tema; entonces adelanta la primera de otro tema, si queda alguna.
 */
export function limitTopicRuns<T extends { readonly topicId: string | null }>(
  items: readonly T[],
  maxRun: number,
): T[] {
  const rest = [...items];
  const out: T[] = [];
  let runTopic: string | null | undefined;
  let runLength = 0;
  while (rest.length > 0) {
    const other = runLength >= maxRun ? rest.findIndex((i) => i.topicId !== runTopic) : -1;
    const [next] = rest.splice(Math.max(0, other), 1);
    if (!next) break;
    runLength = next.topicId === runTopic ? runLength + 1 : 1;
    runTopic = next.topicId;
    out.push(next);
  }
  return out;
}

/**
 * P4: el aprendizaje nuevo va por tema, en tramos de hasta `maxRun` seguidas; los tramos
 * rotan entre temas. Dentro de un tema, en orden de creación (UUIDv7).
 */
function byTopicChunks(cards: readonly PlannerCard[], maxRun: number): QueueItem[] {
  const ordered = [...cards].sort(
    (a, b) => a.state.due - b.state.due || compareIds(a.state.cardId, b.state.cardId),
  );
  const topics = new Map<string | null, PlannerCard[]>();
  for (const card of ordered) topics.set(card.topicId, [...(topics.get(card.topicId) ?? []), card]);
  const out: QueueItem[] = [];
  const pending = [...topics.values()];
  while (pending.some((list) => list.length > 0)) {
    for (const list of pending) out.push(...list.splice(0, maxRun).map((card) => item(card, 'new')));
  }
  return out;
}

export type NextStep =
  | { readonly kind: 'card'; readonly item: QueueItem }
  /** Solo quedan tarjetas en aprendizaje que vuelven más tarde. */
  | { readonly kind: 'wait'; readonly until: number }
  | { readonly kind: 'done' };

/**
 * Siguiente tarjeta de la sesión, derivada de los estados (sin estado propio): primero las
 * que están en aprendizaje y ya volvieron a vencer, luego la siguiente de la cola que aún
 * no respondió en esta sesión.
 */
export function nextCard(
  queue: readonly QueueItem[],
  states: ReadonlyMap<string, CardState>,
  sessionStartedAt: number,
  now: number,
): NextStep {
  let learning: { item: QueueItem; due: number } | null = null;
  let pending: QueueItem | null = null;
  let waitUntil: number | null = null;
  for (const queued of queue) {
    const s = states.get(queued.cardId);
    if (!s) continue; // borrada durante la sesión
    const answered = s.lastReview !== null && s.lastReview >= sessionStartedAt;
    if (!answered) pending ??= queued;
    else if (s.phase === 'learning' || s.phase === 'relearning') {
      if (s.due > now) waitUntil = Math.min(waitUntil ?? s.due, s.due);
      else if (!learning || s.due < learning.due) learning = { item: queued, due: s.due };
    }
  }
  if (learning) return { kind: 'card', item: learning.item };
  if (pending) return { kind: 'card', item: pending };
  return waitUntil === null ? { kind: 'done' } : { kind: 'wait', until: waitUntil };
}

/** P3: con `leechLapses` lapsos o más desde su última reformulación, va a "reformular". */
export const isLeech = (
  card: Pick<PlannerCard, 'state' | 'lapseBaseline'>,
  cfg: Pick<PlannerConfig, 'leechLapses'>,
): boolean => card.state.lapses - card.lapseBaseline >= cfg.leechLapses;
