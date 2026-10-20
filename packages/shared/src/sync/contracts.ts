import { z } from 'zod';
import { ApiErrorCodeSchema } from '../errors.js';
import { EntityNameSchema, opForEntity } from './entities.js';
import { HlcStringSchema } from './hlc.js';

// Contratos de sync (SYNC §3 y §4). `row` se valida dos veces: aquí solo como objeto,
// y después con el esquema de su entidad en el handler del servidor (BACKEND BE2).

/** Columnas comunes de toda entidad LWW tal como viajan (el servidor agrega userId). */
export const SyncMetaSchema = z.object({
  id: z.uuid(),
  hlc: HlcStringSchema,
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().nullable(),
});
export type SyncMeta = z.infer<typeof SyncMetaSchema>;

export const MutationSchema = z
  .object({
    mutationId: z.uuid(),
    op: z.enum(['upsert', 'append']),
    entity: EntityNameSchema,
    row: z.record(z.string(), z.unknown()),
  })
  .refine((m) => m.op === opForEntity(m.entity), { path: ['op'], message: 'op_does_not_match_strategy' });
export type Mutation = z.infer<typeof MutationSchema>;

export const MAX_MUTATIONS_PER_PUSH = 200;

export const PushRequestSchema = z.object({
  deviceId: z.uuid(),
  mutations: z.array(MutationSchema).min(1).max(MAX_MUTATIONS_PER_PUSH),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const PushStatusSchema = z.enum(['applied', 'duplicate', 'stale', 'rejected']);

export const PushResultSchema = z.object({
  mutationId: z.uuid(),
  status: PushStatusSchema,
  code: ApiErrorCodeSchema.optional(),
});
export type PushResult = z.infer<typeof PushResultSchema>;

export const PushResponseSchema = z.object({ results: z.array(PushResultSchema) });
export type PushResponse = z.infer<typeof PushResponseSchema>;

/** `serverSeq` es bigint: viaja como texto de dígitos. */
export const CursorSchema = z.string().regex(/^\d{1,19}$/, 'invalid_cursor');

export const MAX_PULL_LIMIT = 500;

export const PullQuerySchema = z.object({
  cursor: CursorSchema.default('0'),
  limit: z.coerce.number().int().min(1).max(MAX_PULL_LIMIT).default(MAX_PULL_LIMIT),
});
export type PullQuery = z.infer<typeof PullQuerySchema>;

export const PullResponseSchema = z.object({
  changes: z.array(z.object({ entity: EntityNameSchema, row: z.record(z.string(), z.unknown()) })),
  cursor: CursorSchema,
  hasMore: z.boolean(),
  /** Reloj del servidor para estimar `serverOffsetMs` (SYNC SY7). */
  serverNow: z.number().int().nonnegative(),
});
export type PullResponse = z.infer<typeof PullResponseSchema>;
