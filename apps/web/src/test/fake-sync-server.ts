import {
  compareHlc,
  type PullResponse,
  type PushRequest,
  PushRequestSchema,
  type PushResponse,
  type PushResult,
  type SyncedEntity,
  SYNC_ROW_SCHEMAS,
} from '@estudio/shared';
import { ApiError } from '@/lib/api';
import type { SyncTransport } from '@/sync/engine';

interface Stored {
  readonly entity: SyncedEntity;
  readonly row: Record<string, unknown> & { id: string; hlc?: string; deletedAt?: number | null };
  readonly seq: bigint;
}

/**
 * Servidor de sync en memoria con la misma semántica que la API (SYNC §3-§4): LWW por HLC,
 * append idempotente, `server_seq` global y 410 tras una purga. Sirve para probar el
 * cliente y la convergencia de varias réplicas sin red.
 */
export class FakeSyncServer {
  private seq = 0n;
  private readonly rows = new Map<string, Stored>();
  private readonly applied = new Set<string>();
  purgedThroughSeq = 0n;
  /** SY-T3: la próxima respuesta de push se pierde después de aplicar. */
  dropNextPushResponse = false;
  pullsServed = 0;

  constructor(
    private readonly pageSize = 500,
    private readonly now: () => number = () => Date.UTC(2026, 9, 20, 12),
  ) {}

  readonly transport: SyncTransport = {
    push: (request) => this.push(request),
    pull: (cursor) => this.pull(cursor),
  };

  push(request: PushRequest): Promise<PushResponse> {
    // Como el ZodPipe de la API: un sobre inválido (p. ej. un `op` que no es el de la
    // estrategia de su entidad) rechaza la petición entera con 400.
    if (!PushRequestSchema.safeParse(request).success)
      return Promise.reject(new ApiError(400, 'validation_failed'));
    const results = request.mutations.map((m): PushResult => {
      if (this.applied.has(m.mutationId)) return { mutationId: m.mutationId, status: 'duplicate' };
      const schema = SYNC_ROW_SCHEMAS[m.entity as SyncedEntity] as
        (typeof SYNC_ROW_SCHEMAS)[SyncedEntity] | undefined;
      const parsed = schema?.safeParse(m.row);
      if (!parsed?.success)
        return { mutationId: m.mutationId, status: 'rejected', code: 'validation_failed' };
      this.applied.add(m.mutationId);

      const row = parsed.data as Stored['row'];
      const key = `${m.entity}:${row.id}`;
      const existing = this.rows.get(key);
      if (m.op === 'append') {
        if (existing) return { mutationId: m.mutationId, status: 'duplicate' };
      } else if (existing && compareHlc(row.hlc ?? '', existing.row.hlc ?? '') <= 0) {
        return { mutationId: m.mutationId, status: 'stale' };
      }
      this.seq += 1n;
      this.rows.set(key, { entity: m.entity as SyncedEntity, row, seq: this.seq });
      return { mutationId: m.mutationId, status: 'applied' };
    });
    if (this.dropNextPushResponse) {
      this.dropNextPushResponse = false;
      return Promise.reject(new ApiError(0, 'network'));
    }
    return Promise.resolve({ results });
  }

  pull(cursor: string): Promise<PullResponse> {
    this.pullsServed += 1;
    const from = BigInt(cursor);
    if (from > 0n && from < this.purgedThroughSeq) return Promise.reject(new ApiError(410, 'cursor_expired'));
    const pending = [...this.rows.values()]
      .filter((r) => r.seq > from)
      .sort((a, b) => (a.seq < b.seq ? -1 : 1));
    const page = pending.slice(0, this.pageSize);
    return Promise.resolve({
      changes: page.map(({ entity, row }) => ({ entity, row })),
      cursor: page.at(-1)?.seq.toString() ?? cursor,
      hasMore: pending.length > this.pageSize,
      serverNow: this.now(),
    });
  }

  /** Filas vivas de una entidad, ordenadas por id. */
  alive(entity: SyncedEntity): Stored['row'][] {
    return [...this.rows.values()]
      .filter((r) => r.entity === entity && (r.row.deletedAt ?? null) === null)
      .map((r) => r.row)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Simula la purga de borrados del servidor (SYNC §6). */
  purgeTombstones(): void {
    for (const [key, stored] of this.rows) {
      if ((stored.row.deletedAt ?? null) === null) continue;
      this.rows.delete(key);
      // Un cliente que ya vio este borrado puede seguir; uno anterior recibe 410.
      if (stored.seq > this.purgedThroughSeq) this.purgedThroughSeq = stored.seq;
    }
  }

  count(entity: SyncedEntity): number {
    return [...this.rows.values()].filter((r) => r.entity === entity).length;
  }
}
