import {
  CONTRAST_MEMBERS,
  type ContrastArm,
  type ContrastConfig,
  DAY_MS,
  Rating,
  type ReviewLog,
} from '@estudio/shared';
import { byReviewOrder } from '../fsrs/scheduler.js';
import { type Proportion, proportion } from '../metrics/weekly.js';
import { isLearnedReview, isRecalled } from './history.js';

// Sets de contraste (STUDY-METHODS R9, P4; LEARNING-DESIGN LD10). Un set junta, uno tras otro,
// los repasos de hoy de tarjetas que ella marcó como confundibles. No adelanta repasos ni
// cambia fechas de FSRS: solo el orden de la cola. Como la evidencia es contradictoria ([7]
// frente a [8]), cada grupo cae en un brazo del A/B y se compara su retención.

/** Un grupo, como lo necesita el planificador: las Cards vivas de cada nota viva. */
export interface ContrastPlanGroup {
  readonly id: string;
  readonly arm: ContrastArm;
  /** Un elemento por miembro (nota), con los ids de sus Cards. */
  readonly members: readonly (readonly string[])[];
}

/**
 * LD10: brazo de un grupo nuevo. Con pocos grupos un sorteo libre puede dejarlos todos del
 * mismo lado, así que se aleatoriza por bloques de 2: va al brazo con menos grupos y, si están
 * parejos, decide la semilla (que se guarda con el grupo).
 */
export function drawContrastArm(seed: number, counts: Readonly<Record<ContrastArm, number>>): ContrastArm {
  if (counts.contrast !== counts.control) return counts.contrast < counts.control ? 'contrast' : 'control';
  return seed % 2 === 0 ? 'contrast' : 'control';
}

/** Hora del primer acierto (cualquier calificación salvo Again) de cada Card. */
export function firstCorrectByCard(logs: readonly ReviewLog[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const log of logs) {
    if (log.rating === Rating.Again) continue;
    const seen = first.get(log.cardId);
    if (seen === undefined || log.reviewedAt < seen) first.set(log.cardId, log.reviewedAt);
  }
  return first;
}

/**
 * R9, P4: el grupo queda listo cuando cada miembro tuvo su primer acierto ("tras aprenderlos
 * por separado"): la hora del último de esos primeros aciertos. `null` si falta alguno o si
 * quedan menos de 2 miembros vivos.
 */
export function contrastReadyAt(
  group: Pick<ContrastPlanGroup, 'members'>,
  firstCorrect: ReadonlyMap<string, number>,
): number | null {
  const members = group.members.filter((cards) => cards.length > 0);
  if (members.length < CONTRAST_MEMBERS.min) return null;
  let readyAt = 0;
  for (const cards of members) {
    const times = cards.flatMap((id) => firstCorrect.get(id) ?? []);
    if (times.length === 0) return null;
    readyAt = Math.max(readyAt, Math.min(...times));
  }
  return readyAt;
}

/** Lo que el set necesita de cada elemento de la cola. */
interface SetItem {
  readonly cardId: string;
  readonly kind: 'review' | 'new';
  readonly contrastGroupId?: string;
}

/**
 * P4, LD10: en los grupos listos del brazo `contrast`, los repasos de hoy de sus miembros van
 * seguidos, en el lugar del más urgente y en el orden de la cola, hasta `maxSetSize`. Hace
 * falta que sean de al menos 2 miembros. Una tarjeta entra en un solo set; el control no cambia.
 */
export function applyContrastSets<T extends SetItem>(
  items: readonly T[],
  groups: readonly ContrastPlanGroup[],
  ready: ReadonlySet<string>,
  maxSetSize: number,
): T[] {
  let out = [...items];
  const used = new Set<string>();
  const ordered = [...groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const group of ordered) {
    if (group.arm !== 'contrast' || !ready.has(group.id)) continue;
    const memberOf = new Map<string, number>();
    group.members.forEach((cards, member) => {
      for (const id of cards) memberOf.set(id, member);
    });
    const picked = out
      .filter((it) => it.kind === 'review' && memberOf.has(it.cardId) && !used.has(it.cardId))
      .slice(0, maxSetSize);
    if (new Set(picked.map((it) => memberOf.get(it.cardId))).size < CONTRAST_MEMBERS.min) continue;
    const [head] = picked;
    if (!head) continue;
    const at = out.indexOf(head);
    const rest = out.filter((it) => !picked.includes(it));
    const set = picked.map((it) => ({ ...it, contrastGroupId: group.id }));
    out = [...rest.slice(0, at), ...set, ...rest.slice(at)];
    for (const it of picked) used.add(it.cardId);
  }
  return out;
}

export interface ContrastComparison {
  /** Retención (Good y Easy, §5) a `retentionMinDays` días o más, en cada brazo. */
  readonly contrast: Proportion;
  readonly control: Proportion;
  /** UX9: ambos brazos tienen `minReviewsPerArm` repasos; si no, "pocos datos todavía". */
  readonly enough: boolean;
}

/**
 * LD10: retención a 7 días o más de las tarjetas de grupos listos, por brazo. Cuenta los
 * repasos (`review` o `contrast`) hechos después de que el grupo quedó listo, cuando pasaron
 * al menos `retentionMinDays` días desde el repaso anterior de esa tarjeta. Una tarjeta que
 * está en grupos de los dos brazos no cuenta.
 */
export function contrastComparison(
  groups: readonly ContrastPlanGroup[],
  logs: readonly ReviewLog[],
  cfg: ContrastConfig,
): ContrastComparison {
  const firstCorrect = firstCorrectByCard(logs);
  const cards = new Map<string, { arm: ContrastArm | 'both'; readyAt: number }>();
  for (const group of groups) {
    const readyAt = contrastReadyAt(group, firstCorrect);
    if (readyAt === null) continue;
    for (const id of group.members.flat()) {
      const seen = cards.get(id);
      cards.set(
        id,
        seen
          ? { arm: seen.arm === group.arm ? seen.arm : 'both', readyAt: Math.min(seen.readyAt, readyAt) }
          : { arm: group.arm, readyAt },
      );
    }
  }
  const count = { contrast: { total: 0, recalled: 0 }, control: { total: 0, recalled: 0 } };
  const byCard = new Map<string, ReviewLog[]>();
  for (const log of logs) {
    if (log.type === 'exam' || !cards.has(log.cardId)) continue;
    byCard.set(log.cardId, [...(byCard.get(log.cardId) ?? []), log]);
  }
  for (const [id, cardLogs] of byCard) {
    const card = cards.get(id);
    if (!card || card.arm === 'both') continue;
    const ordered = cardLogs.sort(byReviewOrder);
    ordered.forEach((log, i) => {
      const previous = ordered[i - 1];
      if (!previous || !isLearnedReview(log.type) || log.reviewedAt < card.readyAt) return;
      if (log.reviewedAt - previous.reviewedAt < cfg.retentionMinDays * DAY_MS) return;
      const arm = count[card.arm as ContrastArm];
      arm.total += 1;
      if (isRecalled(log.rating)) arm.recalled += 1;
    });
  }
  return {
    contrast: proportion(count.contrast.recalled, count.contrast.total),
    control: proportion(count.control.recalled, count.control.total),
    enough: count.contrast.total >= cfg.minReviewsPerArm && count.control.total >= cfg.minReviewsPerArm,
  };
}
