import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { ContrastEditorScreen } from './ContrastEditorScreen';
import { ContrastScreen } from './ContrastScreen';

const basic = (front: string) =>
  ({ kind: 'basic', front, back: 'x', explanation: '', reverse: false }) as const;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/contrast" element={<ContrastScreen />} />
        <Route path="/contrast/new" element={<ContrastEditorScreen />} />
        <Route path="/contrast/:groupId" element={<ContrastEditorScreen />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

describe('Tarjetas que se confunden (R9, LD10)', () => {
  it('sin grupos ofrece crear uno y explica el A/B con sus fuentes (R20)', async () => {
    renderAt('/contrast');
    expect(
      await screen.findByText('Todavía no hay grupos. Crea uno con tarjetas que se te mezclen.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /^\[7\]/ }).getAttribute('href')).toBe(
      'https://doi.org/10.1037/bul0000209',
    );
    expect(screen.getByRole('link', { name: /^\[8\]/ })).toBeTruthy();
  });

  it('crea un grupo buscando tarjetas; pide nombre y 2 tarjetas; luego aparece con su estado', async () => {
    await createNote({ deck: { name: 'Cabeza' }, content: basic('¿Nervio del recto lateral?') });
    await createNote({ deck: { name: 'Cabeza' }, content: basic('¿Nervio del oblicuo superior?') });
    await createNote({ deck: { name: 'Brazo' }, content: basic('¿Nervio del deltoides?') });
    renderAt('/contrast/new');

    fireEvent.change(await screen.findByLabelText('Nombre del grupo'), {
      target: { value: 'Motores del ojo' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Agregar tarjetas' }), {
      target: { value: 'nervio del O' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar ¿Nervio del oblicuo superior?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar grupo' }));
    expect(screen.getByRole('alert').textContent).toBe('Ponle un nombre y elige al menos 2 tarjetas.');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Agregar tarjetas' }), {
      target: { value: 'recto' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar ¿Nervio del recto lateral?' }));
    expect(screen.getByRole('heading', { name: 'Tarjetas del grupo (2 de 20)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar grupo' }));

    expect(await screen.findByText('Motores del ojo')).toBeTruthy();
    expect(screen.getByText('Falta el primer acierto de 2 tarjetas.')).toBeTruthy();
    expect(screen.getByText(/^Pocos datos todavía/)).toBeTruthy();
    await waitFor(async () => {
      expect((await db.contrastGroups.toArray()).map((g) => g.noteIds.length)).toEqual([2]);
    });
  });
});
