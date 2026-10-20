import { z } from 'zod';
import { TimerModeSchema } from '../config/study-config.js';
import { SyncMetaSchema } from '../sync/contracts.js';

// Temporizador (STUDY-METHODS §3, SYNC SY7, ADR-006). Aquí solo la forma de lo que se
// guarda y viaja; las transiciones las valida la máquina de `srs/timer`.

export const TimerPhaseSchema = z.enum(['idle', 'focus', 'paused', 'break_short', 'break_long', 'ended']);
export type TimerPhase = z.infer<typeof TimerPhaseSchema>;

/** `superseded`: el servidor cerró una segunda sesión activa (SYNC §5). */
export const TimerEndedReasonSchema = z.enum(['user', 'superseded']);
export type TimerEndedReason = z.infer<typeof TimerEndedReasonSchema>;

const epochMs = () => z.number().int().nonnegative();

/**
 * Estado de la máquina. El tiempo restante sale de estas marcas, nunca de contar ticks (§3).
 * `blockIndex` es el índice del bloque de enfoque en curso; entre bloques (descanso o idle)
 * es el que usará el siguiente.
 */
export const TimerStateSchema = z.object({
  state: TimerPhaseSchema,
  mode: TimerModeSchema,
  /** Inicio de la fase actual (bloque o descanso); null en idle y ended. */
  startedAt: epochMs().nullable(),
  pausedAt: epochMs().nullable(),
  /** Tiempo en pausa dentro del bloque actual. */
  pausedMs: epochMs(),
  blockIndex: z.number().int().nonnegative(),
  /** Bloques completados en la sesión: deciden el descanso largo (R7, `cyclesBeforeLong`). */
  completedBlocks: z.number().int().nonnegative(),
  plannedMs: epochMs(),
  extendedThisBlock: z.boolean(), // §3: "+5 min" una vez por bloque en modo flexible
  ownerDeviceId: z.uuid(),
  /** Marca más alta del reloj vista: el reloj de la máquina nunca retrocede (QA2). */
  lastSeenAt: epochMs().nullable(),
  endedReason: TimerEndedReasonSchema.nullable(),
});
export type TimerState = z.infer<typeof TimerStateSchema>;

export const TimerBlockKindSchema = z.enum(['focus', 'break_short', 'break_long']);
export type TimerBlockKind = z.infer<typeof TimerBlockKindSchema>;

/** §3: `manual` es el tiempo que ella declara fuera de la app; no se mezcla con el activo. */
export const TimerBlockOutcomeSchema = z.enum(['completed', 'interrupted', 'manual']);
export type TimerBlockOutcome = z.infer<typeof TimerBlockOutcomeSchema>;

/**
 * Bloque o descanso cerrado (solo inserción, SYNC SY7). P6 cuenta los bloques `completed`;
 * en descansos, `activeMs` es el tiempo transcurrido y `interrupted` significa omitido.
 */
export const TimerBlockLogSchema = z
  .object({
    id: z.uuid(),
    timerSessionId: z.uuid(),
    deviceId: z.uuid(),
    kind: TimerBlockKindSchema,
    blockIndex: z.number().int().nonnegative(),
    mode: TimerModeSchema,
    startedAt: epochMs(),
    endedAt: epochMs(),
    plannedMs: epochMs(),
    activeMs: epochMs(),
    outcome: TimerBlockOutcomeSchema,
    /** §3, §5: el bloque usó "+N min" (modo flexible). Un cliente anterior no lo envía. */
    extended: z.boolean().default(false),
  })
  .strict()
  .refine((b) => b.endedAt >= b.startedAt, { path: ['endedAt'], message: 'ended_before_started' });
export type TimerBlockLog = z.infer<typeof TimerBlockLogSchema>;

/**
 * Sesión del temporizador tal como viaja (LWW, SYNC SY7). Una sola activa por cuenta:
 * el servidor cierra las demás como `superseded` (ADR-006, SYNC §5).
 */
export const TimerSessionSchema = SyncMetaSchema.extend(TimerStateSchema.shape).strict();
export type TimerSession = z.infer<typeof TimerSessionSchema>;

/** Activa = cuenta para "una por cuenta" (SY7): ni en reposo ni terminada. */
export const isTimerActive = (t: Pick<TimerState, 'state'>): boolean =>
  t.state !== 'idle' && t.state !== 'ended';
