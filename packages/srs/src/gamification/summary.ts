import {
  type GamificationConfig,
  isExerciseKind,
  localDayNumber,
  type ReviewLog,
  type RewardRedemption,
  type TimerBlockLog,
} from '@estudio/shared';

// Gamificación (UI-UX UX10). Diseño · sin evidencia: STUDY-METHODS §6 no la investigó. Todo es
// proyección de los logs (SYNC §1): XP, nivel, monedas, logros y racha no viajan ni se guardan.
// Nada depende de la calificación (R19) ni del tiempo con la app abierta (R21).

/**
 * Logros por conductas propias, nunca por comparación (UX10). Solo salen de logs de solo
 * inserción, así no desaparecen al borrar algo ni difieren entre dispositivos.
 */
export const BADGES = [
  'first_review',
  'first_exercise',
  'first_contrast_set',
  'first_mock',
  'first_focus_block',
] as const;
export type BadgeId = (typeof BADGES)[number];

export type GamificationLog = Pick<ReviewLog, 'reviewedAt' | 'type' | 'cardKind'>;
export type GamificationBlock = Pick<TimerBlockLog, 'kind' | 'outcome' | 'endedAt'>;

export interface GamificationInput {
  readonly logs: readonly GamificationLog[];
  readonly blocks: readonly GamificationBlock[];
  readonly redemptions: readonly Pick<RewardRedemption, 'cost'>[];
  readonly config: GamificationConfig;
  readonly now: number;
  /** Zona de ella (AG6): la racha cuenta días locales. */
  readonly timeZone: string;
}

export interface LevelProgress {
  /** Empieza en 1. */
  readonly level: number;
  /** XP ganada dentro del nivel actual. */
  readonly xpInLevel: number;
  /** XP que pide el nivel actual para pasar al siguiente. */
  readonly xpForLevel: number;
}

export interface Coins {
  readonly earned: number;
  readonly spent: number;
  /** Puede quedar negativo si dos dispositivos sin red canjearon a la vez; la UI no deja canjear. */
  readonly balance: number;
}

export interface EarnedBadge {
  readonly id: BadgeId;
  /** Cuándo hizo por primera vez lo que lo da. */
  readonly earnedAt: number;
}

export interface Streak {
  /** Días locales con al menos un repaso. Un día sin estudiar no la reinicia (UX10, R19). */
  readonly days: number;
  /** `paused`: el último día con repasos fue antes de ayer. */
  readonly state: 'active' | 'paused';
}

export interface GamificationSummary {
  readonly reviews: number;
  readonly xp: number;
  readonly level: LevelProgress;
  readonly coins: Coins;
  /** En el orden de `BADGES`. */
  readonly badges: readonly EarnedBadge[];
  /** null si ella no activó la racha (`streakEnabled`, apagada por defecto). */
  readonly streak: Streak | null;
}

/** UX10: la misma XP por cada repaso respondido, sin importar la calificación. */
export const xpForReviews = (reviews: number, cfg: GamificationConfig): number => reviews * cfg.xpPerReview;

/** XP que pide el nivel `level` para pasar al siguiente: `baseXp × level^exponent`. */
export const xpForLevel = (level: number, cfg: GamificationConfig): number =>
  Math.max(1, Math.round(cfg.levelCurve.baseXp * level ** cfg.levelCurve.exponent));

export function levelProgress(xp: number, cfg: GamificationConfig): LevelProgress {
  let level = 1;
  let rest = xp;
  for (let need = xpForLevel(level, cfg); rest >= need; need = xpForLevel(level, cfg)) {
    rest -= need;
    level += 1;
  }
  return { level, xpInLevel: rest, xpForLevel: xpForLevel(level, cfg) };
}

/** Monedas ganadas con esa XP. Se redondea antes de truncar para no perder una por error de coma flotante. */
export const coinsForXp = (xp: number, cfg: GamificationConfig): number =>
  Math.floor(Math.round(xp * cfg.coinsPerXp * 1e6) / 1e6);

/** Saldo con la XP de `reviews` repasos y los canjes hechos (para validar un canje sin el worker). */
export function coinBalance(
  reviews: number,
  redemptions: readonly Pick<RewardRedemption, 'cost'>[],
  cfg: GamificationConfig,
): Coins {
  const earned = coinsForXp(xpForReviews(reviews, cfg), cfg);
  const spent = redemptions.reduce((sum, r) => sum + r.cost, 0);
  return { earned, spent, balance: earned - spent };
}

const badgeOfLog = (log: GamificationLog): BadgeId[] => {
  const ids: BadgeId[] = ['first_review'];
  if (isExerciseKind(log.cardKind)) ids.push('first_exercise');
  if (log.type === 'contrast') ids.push('first_contrast_set');
  if (log.type === 'exam') ids.push('first_mock');
  return ids;
};

function earnedBadges(logs: readonly GamificationLog[], blocks: readonly GamificationBlock[]): EarnedBadge[] {
  const first = new Map<BadgeId, number>();
  const see = (id: BadgeId, at: number) => {
    const known = first.get(id);
    if (known === undefined || at < known) first.set(id, at);
  };
  for (const log of logs) for (const id of badgeOfLog(log)) see(id, log.reviewedAt);
  for (const block of blocks) {
    if (block.kind === 'focus' && block.outcome === 'completed') see('first_focus_block', block.endedAt);
  }
  return BADGES.flatMap((id) => {
    const earnedAt = first.get(id);
    return earnedAt === undefined ? [] : [{ id, earnedAt }];
  });
}

function streakOf(logs: readonly GamificationLog[], now: number, timeZone: string): Streak {
  const days = new Set(logs.map((log) => localDayNumber(log.reviewedAt, timeZone)));
  const last = Math.max(...days);
  const today = localDayNumber(now, timeZone);
  return { days: days.size, state: days.size > 0 && last < today - 1 ? 'paused' : 'active' };
}

/** UX10: lo que muestra la gamificación, calculado en el worker (FRONTEND FE4). */
export function gamificationSummary(input: GamificationInput): GamificationSummary {
  const { config } = input;
  const reviews = input.logs.length;
  const xp = xpForReviews(reviews, config);
  return {
    reviews,
    xp,
    level: levelProgress(xp, config),
    coins: coinBalance(reviews, input.redemptions, config),
    badges: earnedBadges(input.logs, input.blocks),
    streak: config.streakEnabled ? streakOf(input.logs, input.now, input.timeZone) : null,
  };
}

export type Milestone =
  { readonly kind: 'level'; readonly level: number } | { readonly kind: 'badge'; readonly id: BadgeId };

/** Lo que decide un hito: el nivel y los logros. */
export type MilestoneState = Pick<GamificationSummary, 'reviews' | 'level' | 'badges'>;

/**
 * Nivel y logros después de `added`, a partir de un resumen ya calculado. Recorre solo lo
 * nuevo: sirve en el hilo principal durante una sesión, sin el log completo (FE4, FE9).
 */
export function progressAfter(
  before: MilestoneState,
  added: { readonly logs: readonly GamificationLog[]; readonly blocks: readonly GamificationBlock[] },
  cfg: GamificationConfig,
): MilestoneState {
  const reviews = before.reviews + added.logs.length;
  const known = new Map(before.badges.map((b) => [b.id, b.earnedAt]));
  for (const badge of earnedBadges(added.logs, added.blocks)) {
    if (!known.has(badge.id)) known.set(badge.id, badge.earnedAt);
  }
  return {
    reviews,
    level: levelProgress(xpForReviews(reviews, cfg), cfg),
    badges: BADGES.flatMap((id) => {
      const earnedAt = known.get(id);
      return earnedAt === undefined ? [] : [{ id, earnedAt }];
    }),
  };
}

/**
 * UX6: las celebraciones son solo para hitos (subir de nivel, un logro), nunca para cada
 * tarjeta. Compara dos estados de la misma cuenta.
 */
export function newMilestones(before: MilestoneState, after: MilestoneState): Milestone[] {
  const had = new Set(before.badges.map((b) => b.id));
  const milestones: Milestone[] =
    after.level.level > before.level.level ? [{ kind: 'level', level: after.level.level }] : [];
  for (const badge of after.badges) if (!had.has(badge.id)) milestones.push({ kind: 'badge', id: badge.id });
  return milestones;
}
