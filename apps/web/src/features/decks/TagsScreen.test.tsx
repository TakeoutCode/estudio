import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { TagsScreen } from './TagsScreen';

const T0 = Date.UTC(2026, 9, 20, 15);
const basic = (front: string) =>
  ({ kind: 'basic', front, back: 'R', explanation: '', reverse: false }) as const;

const renderTags = () =>
  render(
    <MemoryRouter initialEntries={['/tags']}>
      <TagsScreen />
    </MemoryRouter>,
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TagsScreen (diseño)', () => {
  it('UX3: sin etiquetas dice cómo se agregan', async () => {
    renderTags();
    expect(await screen.findByText(/Todavía no hay etiquetas/)).toBeTruthy();
  });

  it('cada etiqueta con sus tarjetas de varios mazos y un enlace para estudiarla', async () => {
    const atlas = await createNote(
      { deck: { name: 'Columna' }, content: basic('¿C1?'), tags: [{ name: 'Parcial 2' }] },
      { now: T0 - 2 },
    );
    await createNote(
      { deck: { name: 'Cráneo' }, content: basic('¿Occipital?'), tags: [{ id: atlas.tagIds[0] ?? '' }] },
      { now: T0 - 1 },
    );
    renderTags();
    expect(await screen.findByText('Parcial 2')).toBeTruthy();
    expect(screen.getByText(/2 tarjetas/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Estudiar la etiqueta Parcial 2' }).getAttribute('href')).toBe(
      `/study?etiqueta=${atlas.tagIds[0] ?? ''}`,
    );
  });

  it('renombrar avisa si el nombre ya existe; borrar pide confirmación y la quita de sus tarjetas', async () => {
    const note = await createNote(
      {
        deck: { name: 'Columna' },
        content: basic('¿C1?'),
        tags: [{ name: 'Cervical' }, { name: 'Parcial' }],
      },
      { now: T0 - 1 },
    );
    renderTags();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar la etiqueta Cervical' }));
    const input = screen.getByRole('textbox', { name: 'Nombre de la etiqueta' });
    fireEvent.change(input, { target: { value: 'parcial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Ya tienes una etiqueta con ese nombre.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Borrar etiqueta' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Su 1 tarjeta la pierde/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Borrar etiqueta' }));
    await waitFor(() => {
      expect(screen.queryByText('Cervical')).toBeNull();
    });
    expect((await db.notes.get(note.id))?.tagIds).toEqual([note.tagIds[1]]);
  });
});
