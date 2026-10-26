import { ENTITY_STRATEGY, type SyncedEntity } from '@estudio/shared';
import { Transactional } from '@nestjs-cls/transactional';
import { Injectable, Logger } from '@nestjs/common';
import { UseCls } from 'nestjs-cls';
import { type EntitySyncHandler, SyncHandlerRegistry } from './sync-handler.js';
import { SyncRepository } from './sync.repository.js';

const DAY_MS = 86_400_000;
/** SYNC §6: los borrados viven 90 días; mientras tanto, editar en otro dispositivo los revive. */
export const SYNC_TOMBSTONE_RETENTION_DAYS = 90;
/** SYNC §3: `applied_mutation` se purga a los 30 días sin perder idempotencia. */
export const APPLIED_MUTATION_RETENTION_DAYS = 30;
/** Tombstones por tabla y vuelta; lo que sobra sale al día siguiente. Límite técnico. */
const PURGE_BATCH = 5000;
const PURGE_LOCK = 'sync:purge';

type Handler = EntitySyncHandler<SyncedEntity>;
/** Por cuenta, los ids de cada entidad (con su handler) que se pueden purgar. */
export type PurgeBatch = ReadonlyMap<Handler, readonly string[]>;
type Candidates = Map<string, Map<Handler, string[]>>;

export interface PurgeSummary {
  readonly appliedMutations: number;
  readonly tombstones: number;
  /** Borrados que esperan a la próxima vuelta porque su limpieza externa falló. */
  readonly deferred: number;
}

/**
 * SYNC §3 y §6: limpieza diaria del servidor. Bajo advisory lock (ARC7) purga `applied_mutation`
 * viejas y elige los tombstones LWW de más de 90 días; fuera de transacción corre la limpieza
 * externa de cada entidad (BE7: la imagen en Cloudinary); después, por cuenta y con su lock,
 * los borra y sube `purgedThroughSeq`, así un cliente que no los vio hace un pull completo.
 * `ReviewLog` y las demás de solo inserción nunca se purgan.
 */
@Injectable()
export class SyncPurgeService {
  private readonly logger = new Logger(SyncPurgeService.name);

  constructor(
    private readonly registry: SyncHandlerRegistry,
    private readonly repo: SyncRepository,
  ) {}

  @UseCls()
  async run(now: number): Promise<PurgeSummary | null> {
    const claim = await this.claim(now);
    if (!claim) return null;
    let tombstones = 0;
    let deferred = 0;
    for (const [userId, byEntity] of claim.candidates) {
      const allowed = new Map<Handler, readonly string[]>();
      for (const [handler, ids] of byEntity) {
        const ready = await this.readyToPurge(handler, userId, ids);
        deferred += ids.length - ready.length;
        if (ready.length > 0) allowed.set(handler, ready);
      }
      tombstones += await this.purgeUser(userId, allowed, claim.cutoff, now);
    }
    // BE6: solo conteos.
    this.logger.log({ appliedMutations: claim.appliedMutations, tombstones, deferred }, 'Purga de sync');
    return { appliedMutations: claim.appliedMutations, tombstones, deferred };
  }

  /** ARC7: si otra instancia tiene el lock, esta no hace nada. */
  @Transactional()
  async claim(
    now: number,
  ): Promise<{ cutoff: number; appliedMutations: number; candidates: Candidates } | null> {
    if (!(await this.repo.tryJobLock(PURGE_LOCK))) return null;
    const appliedMutations = await this.repo.purgeAppliedMutations(
      new Date(now - APPLIED_MUTATION_RETENTION_DAYS * DAY_MS),
    );
    const cutoff = now - SYNC_TOMBSTONE_RETENTION_DAYS * DAY_MS;
    const candidates: Candidates = new Map();
    for (const handler of this.registry.all()) {
      if (ENTITY_STRATEGY[handler.entity] !== 'lww') continue;
      for (const row of await this.repo.tombstones(handler.table, cutoff, PURGE_BATCH)) {
        const byEntity = candidates.get(row.user_id) ?? new Map<Handler, string[]>();
        candidates.set(row.user_id, byEntity);
        const ids = byEntity.get(handler) ?? [];
        byEntity.set(handler, ids);
        ids.push(row.id);
      }
    }
    return { cutoff, appliedMutations, candidates };
  }

  /** BE7: la limpieza externa corre fuera de transacción; si falla, se reintenta mañana. */
  private async readyToPurge(
    handler: Handler,
    userId: string,
    ids: readonly string[],
  ): Promise<readonly string[]> {
    if (!handler.beforePurge) return ids;
    try {
      const ready = new Set(await handler.beforePurge(userId, ids));
      return ids.filter((id) => ready.has(id));
    } catch {
      this.logger.warn({ entity: handler.entity, count: ids.length }, 'Limpieza externa sin terminar');
      return [];
    }
  }

  /** ADR-005: con el lock de la cuenta, como un push, para no cruzarse con su `server_seq`. */
  @Transactional()
  async purgeUser(userId: string, allowed: PurgeBatch, cutoff: number, now: number): Promise<number> {
    if (allowed.size === 0) return 0;
    await this.repo.lockUser(userId);
    let newest: bigint | null = null;
    let count = 0;
    for (const [handler, ids] of allowed) {
      for (const seq of await this.repo.purgeTombstones(userId, handler.table, ids, cutoff, now)) {
        count += 1;
        if (newest === null || seq > newest) newest = seq;
      }
    }
    if (newest !== null) await this.repo.raisePurgedThroughSeq(userId, newest);
    return count;
  }
}
