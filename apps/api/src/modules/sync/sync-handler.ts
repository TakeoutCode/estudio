import type { ApiErrorCode, SyncedEntity, SyncedRow } from '@estudio/shared';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

export type ApplyStatus = 'applied' | 'stale' | 'duplicate';

/**
 * BACKEND BE2: cada dominio registra sus entidades sincronizables con `@SyncHandler`.
 * `sync` las descubre sin importar los módulos de dominio.
 */
export interface EntitySyncHandler<E extends SyncedEntity> {
  readonly entity: E;
  /** Tabla SQL (constante del código). */
  readonly table: string;
  /** Reglas que el esquema no expresa (fuera de la transacción). `null` si la fila es aceptable. */
  check(userId: string, row: SyncedRow<E>, now: number): ApiErrorCode | null;
  /** Escribe dentro de la transacción del push. */
  apply(userId: string, row: SyncedRow<E>): Promise<ApplyStatus>;
  /** Fila de `to_jsonb(tabla)` → forma del contrato (luego se valida con su esquema). */
  fromDb(data: Readonly<Record<string, unknown>>): unknown;
}

export const SyncHandler = DiscoveryService.createDecorator<SyncedEntity>();

@Injectable()
export class SyncHandlerRegistry implements OnModuleInit {
  private readonly handlers = new Map<SyncedEntity, EntitySyncHandler<SyncedEntity>>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders({ metadataKey: SyncHandler.KEY })) {
      const entity = this.discovery.getMetadataByDecorator(SyncHandler, wrapper);
      const handler = wrapper.instance as EntitySyncHandler<SyncedEntity> | undefined;
      if (!entity || !handler) continue;
      if (this.handlers.has(entity)) throw new Error(`Dos handlers de sync para "${entity}"`);
      this.handlers.set(entity, handler);
    }
  }

  get(entity: SyncedEntity): EntitySyncHandler<SyncedEntity> | undefined {
    return this.handlers.get(entity);
  }

  all(): readonly EntitySyncHandler<SyncedEntity>[] {
    return [...this.handlers.values()];
  }
}
