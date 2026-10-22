import type { DiscoveryService } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { SyncHandlerRegistry } from './sync-handler.js';
import { SyncPurgeScheduler } from './sync-purge.scheduler.js';
import type { SyncPurgeService } from './sync-purge.service.js';

/** DiscoveryService falso: cada proveedor con la entidad de su `@SyncHandler` (o ninguna). */
function registryWith(providers: readonly { entity: string | undefined; instance: unknown }[]) {
  const discovery = {
    getProviders: () => providers,
    getMetadataByDecorator: (_decorator: unknown, wrapper: { entity: string | undefined }) => wrapper.entity,
  } as unknown as DiscoveryService;
  return new SyncHandlerRegistry(discovery);
}

describe('BE2: registro de handlers de sync', () => {
  it('registra cada entidad una vez e ignora proveedores sin entidad o sin instancia', () => {
    const deck = { entity: 'deck', table: 'deck' };
    const registry = registryWith([
      { entity: 'deck', instance: deck },
      { entity: undefined, instance: {} },
      { entity: 'note', instance: undefined },
    ]);
    registry.onModuleInit();
    expect(registry.get('deck')).toBe(deck);
    expect(registry.get('note')).toBeUndefined();
    expect(registry.all()).toEqual([deck]);
  });

  it('dos handlers para la misma entidad es un error al arrancar', () => {
    const registry = registryWith([
      { entity: 'deck', instance: {} },
      { entity: 'deck', instance: {} },
    ]);
    expect(() => {
      registry.onModuleInit();
    }).toThrow('Dos handlers de sync para "deck"');
  });
});

describe('SYNC §6: el cron diario de la purga', () => {
  it('corre la purga con la hora del reloj (AG3: el servicio no la lee por su cuenta)', async () => {
    const run = vi.fn<SyncPurgeService['run']>(() => Promise.resolve(null));
    await new SyncPurgeScheduler({ run } as unknown as SyncPurgeService, { now: () => 1234 }).daily();
    expect(run).toHaveBeenCalledWith(1234);
  });
});
