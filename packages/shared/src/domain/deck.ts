import { z } from 'zod';
import { SyncMetaSchema } from '../sync/contracts.js';

/** Mazo (LWW). Patrón de toda entidad sincronizable: `SyncMetaSchema` + campos propios. */
export const DeckSchema = SyncMetaSchema.extend({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable(),
}).strict();
export type Deck = z.infer<typeof DeckSchema>;
