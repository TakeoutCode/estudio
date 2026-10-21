import { ENTITY_STRATEGY, type EntityName, newId } from '@estudio/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type OutboxEntry } from '@/db/schema';
import { i18next } from '@/lib/i18n';
import { SyncSection } from './SyncSection';

const T0 = Date.UTC(2026, 9, 20, 15);

const entry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  mutationId: newId(),
  op: 'upsert',
  entity: 'deck',
  row: { id: newId() },
  createdAt: T0,
  attempts: 0,
  status: 'pending',
  ...overrides,
});

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

describe('Ajustes › Sincronización (SYNC SY8)', () => {
  it('dice cuántos cambios esperan por enviarse', async () => {
    await db.outbox.bulkAdd([entry(), entry({ entity: 'note' })]);
    render(<SyncSection />);
    expect(await screen.findByText('2 cambios por enviar')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Todavía no se sincroniza en esta visita.');
  });

  it('lo rechazado queda visible con su motivo y se puede reintentar', async () => {
    await db.outbox.add(entry({ entity: 'note', status: 'rejected', attempts: 1, code: 'not_found' }));
    render(<SyncSection />);
    expect(await screen.findByText('El servidor no aceptó 1 cambio.')).toBeTruthy();
    expect(screen.getByText('Tarjeta')).toBeTruthy();
    expect(screen.getByText(/falta algo a lo que apunta/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('1 cambio por enviar')).toBeTruthy();
    expect((await db.outbox.toArray()).map((e) => e.status)).toEqual(['pending']);
  });

  it('NO DEBE borrarse sin avisar: descartar pide confirmación', async () => {
    const rejected = entry({ status: 'rejected', attempts: 2, code: 'validation_failed' });
    await db.outbox.bulkAdd([rejected, entry()]);
    render(<SyncSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('no llegará a tus otros dispositivos');
    expect(await db.outbox.count()).toBe(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    await vi.waitFor(async () => {
      expect((await db.outbox.toArray()).map((e) => e.mutationId)).not.toContain(rejected.mutationId);
    });
    expect(await db.outbox.count()).toBe(1); // lo pendiente no se toca
  });

  it('cada entidad tiene su nombre en el catálogo', () => {
    const missing = (Object.keys(ENTITY_STRATEGY) as EntityName[]).filter(
      (entity) => !i18next.exists(`sync.entity.${entity}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('Ajustes › almacenamiento (FRONTEND FE7)', () => {
  it('muestra el espacio usado y deja pedir guardado persistente', async () => {
    let persisted = false;
    const persist = vi.fn(() => {
      persisted = true;
      return Promise.resolve(true);
    });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: () => Promise.resolve({ usage: 12_400_000, quota: 2_100_000_000 }),
        persisted: () => Promise.resolve(persisted),
        persist,
      },
    });
    render(<SyncSection />);
    expect(await screen.findByText(/La app usa 12,4 MB de unos 2,1 GB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pedir guardado persistente' }));
    expect(await screen.findByText(/Guardado persistente: el navegador no borrará/)).toBeTruthy();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
