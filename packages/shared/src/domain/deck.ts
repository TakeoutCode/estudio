import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

/** Mazo (LWW). Patrón de toda entidad sincronizable: `SyncMetaSchema` + campos propios. */
export const DeckSchema = SyncMetaSchema.extend({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable(),
  /**
   * En pausa desde esa hora (epoch ms, AG6; *diseño*): sus tarjetas no entran en Hoy, en la
   * carga ni en los recordatorios; FSRS no cambia (LD9). `null` = activo. Un cliente con el
   * contrato 8 no lo envía.
   */
  pausedAt: z.number().int().nonnegative().nullable().default(null),
}).strict();
export type Deck = z.infer<typeof DeckSchema>;
