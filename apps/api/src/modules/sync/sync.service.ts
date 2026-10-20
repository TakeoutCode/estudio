import {
  type ApiErrorCode,
  decodeHlc,
  ENTITY_STRATEGY,
  isHlcTooFarAhead,
  isSyncedEntity,
  type Mutation,
  type PullQuery,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type PushResult,
  type SyncedEntity,
  type SyncMeta,
  SYNC_ROW_SCHEMAS,
} from '@estudio/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock.js';
import { DomainError } from '../../common/domain-error.js';
import { type EntitySyncHandler, SyncHandlerRegistry } from './sync-handler.js';
import { SyncRepository } from './sync.repository.js';

interface Accepted {
  readonly mutationId: string;
  readonly handler: EntitySyncHandler<SyncedEntity>;
  readonly row: never;
}

@Injectable()
export class SyncService {
  constructor(
    private readonly registry: SyncHandlerRegistry,
    private readonly repo: SyncRepository,
    private readonly clock: Clock,
  ) {}

  /** SYNC §3: valida fuera de la transacción y aplica todo lo válido en una sola. */
  async push(userId: string, request: PushRequest): Promise<PushResponse> {
    const now = this.clock.now();
    const results = new Map<string, PushResult>();
    const accepted: Accepted[] = [];

    for (const mutation of request.mutations) {
      const prepared = this.prepare(userId, mutation, now);
      if ('code' in prepared) {
        results.set(mutation.mutationId, {
          mutationId: mutation.mutationId,
          status: 'rejected',
          code: prepared.code,
        });
      } else {
        accepted.push(prepared);
      }
    }

    if (accepted.length > 0) {
      for (const result of await this.applyAll(userId, accepted)) results.set(result.mutationId, result);
    }
    return {
      results: request.mutations.map(
        (m) =>
          results.get(m.mutationId) ?? { mutationId: m.mutationId, status: 'rejected', code: 'internal' },
      ),
    };
  }

  /** BE7: un solo commit, con el lock del usuario tomado antes de asignar `server_seq`. */
  @Transactional()
  async applyAll(userId: string, accepted: readonly Accepted[]): Promise<PushResult[]> {
    await this.repo.lockUser(userId);
    const results: PushResult[] = [];
    for (const { mutationId, handler, row } of accepted) {
      // En orden: una tarjeta creada en este mismo lote ya existe cuando llega su repaso.
      const refError = (await handler.refs?.(userId, row)) ?? null;
      if (refError) {
        results.push({ mutationId, status: 'rejected', code: refError });
        continue;
      }
      if (!(await this.repo.recordMutation(userId, mutationId))) {
        results.push({ mutationId, status: 'duplicate' });
        continue;
      }
      results.push({ mutationId, status: await handler.apply(userId, row) });
    }
    return results;
  }

  /** SYNC SY3, SY4: página de cambios ordenada por `server_seq`. */
  async pull(userId: string, query: PullQuery): Promise<PullResponse> {
    const cursor = BigInt(query.cursor);
    // El pull completo (cursor 0) siempre se permite: es la salida del 410 (SYNC §4).
    if (cursor > 0n && cursor < (await this.repo.purgedThroughSeq(userId))) {
      throw new DomainError('cursor_expired');
    }
    const rows = await this.repo.changesSince(userId, cursor, query.limit + 1, this.registry.all());
    const page = rows.slice(0, query.limit);
    const changes = page.map(({ entity, data }) => {
      const handler = this.registry.get(entity);
      if (!handler) throw new Error(`Sin handler de sync para "${entity}"`);
      const row = SYNC_ROW_SCHEMAS[entity].parse(handler.fromDb(data)) as Record<string, unknown>;
      return { entity, row };
    });
    return {
      changes,
      cursor: page.at(-1)?.server_seq.toString() ?? query.cursor,
      hasMore: rows.length > query.limit,
      serverNow: this.clock.now(),
    };
  }

  private prepare(userId: string, mutation: Mutation, now: number): Accepted | { code: ApiErrorCode } {
    const { entity } = mutation;
    const handler = isSyncedEntity(entity) ? this.registry.get(entity) : undefined;
    if (!isSyncedEntity(entity) || !handler) return { code: 'validation_failed' };

    const parsed = SYNC_ROW_SCHEMAS[entity].safeParse(mutation.row);
    if (!parsed.success) return { code: 'validation_failed' };
    const row = parsed.data as never;

    if (ENTITY_STRATEGY[entity] === 'lww') {
      const meta = parsed.data as SyncMeta;
      const hlc = decodeHlc(meta.hlc);
      // SYNC §2: un reloj con la fecha mal puesta no debe ganar todas las escrituras.
      if (isHlcTooFarAhead(hlc, now) || meta.updatedAt !== hlc.wall) return { code: 'validation_failed' };
    }

    const code = handler.check(userId, row, now);
    return code ? { code } : { mutationId: mutation.mutationId, handler, row };
  }
}
