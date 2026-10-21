import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';
import { type LocalDate, LocalDateSchema } from '../time.js';

// Registro de sueño (STUDY-METHODS §5): opcional, un toque, calidad 1-5 y sin gamificar. Es
// contexto para ella: no entra en FSRS, en el planificador ni en los avisos. LWW (SYNC §1).

/** §5: de 1 (muy mal) a 5 (muy bien). */
export const SLEEP_QUALITIES = [1, 2, 3, 4, 5] as const;
export const SleepQualitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type SleepQuality = z.infer<typeof SleepQualitySchema>;

export const SleepLogSchema = SyncMetaSchema.extend({
  /** Día local de ella en que terminó la noche (AG6): "anoche", visto desde ese día. */
  date: LocalDateSchema,
  quality: SleepQualitySchema,
  /** Cuándo lo anotó; `updatedAt` cambia si después lo corrige. */
  loggedAt: z.number().int().nonnegative(),
}).strict();
export type SleepLog = z.infer<typeof SleepLogSchema>;

// Espacio de nombres fijo para los IDs de SleepLog. No cambiar: las noches ya guardadas los usan.
const SLEEP_NAMESPACE = '9a4e7c21-3b5d-4f86-8c0e-1d2f6a7b8e93';

/**
 * Una fila por noche con ID determinista (SYNC §1), como `settingsRowId`: dos dispositivos sin
 * red que anotan la misma noche escriben la misma fila y LWW la resuelve, en vez de duplicarla.
 */
export const sleepLogIdFor = (userId: string, date: LocalDate): string =>
  uuidv5(`${userId}:${date}`, SLEEP_NAMESPACE);
