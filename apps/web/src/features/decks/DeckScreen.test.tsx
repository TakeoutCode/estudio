import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { DeckScreen } from './DeckScreen';

const T0 = Date.UTC(2026, 9, 20, 15);
const basic = (front: string, back = 'R') =>
  ({ kind: 'basic', front, back, explanation: '', reverse: false }) as const;

const renderDeck = (deckId: string) =>
  render(
    <MemoryRouter initialEntries={[`/decks/${deckId}`]}>
      <Routes>
        <Route path="/decks/:deckId" element={<DeckScreen />} />
        <Route path="/decks" element={<p>Lista de mazos</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Mazo "Miembro inferior" con dos tarjetas, la primera con tema. */
async function lowerLimb() {
  const femur = await createNote(
    {
      deck: { name: 'Miembro inferior' },
      content: basic('¿Hueso del muslo?', 'El fémur'),
      topic: { name: 'Huesos largos', explanation: '' },
    },
    { now: T0 - 2 },
  );
  await createNote(
    { deck: { id: femur.deckId }, content: basic('¿Hueso de la rodilla?', 'La rótula') },
    { now: T0 - 1 },
  );
  return femur;
}

describe('pantalla de un mazo', () => {
  it('muestra su carga, temas y tarjetas en orden de creación; estudiar y añadir van a ese mazo', async () => {
    const femur = await lowerLimb();
    renderDeck(femur.deckId);
    expect(await screen.findByRole('heading', { name: 'Miembro inferior' })).toBeTruthy();
    expect(screen.getByText('2 tarjetas · 0 pendientes · 2 nuevas')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Huesos largos' }).getAttribute('href')).toBe(
      `/topics/${femur.topicId ?? ''}`,
    );
    const rows = within(screen.getByRole('region', { name: 'Tarjetas' })).getAllByRole('link');
    expect(rows.map((a) => a.textContent)).toEqual([
      '¿Hueso del muslo?Pregunta y respuesta · Huesos largos',
      '¿Hueso de la rodilla?Pregunta y respuesta',
    ]);
    expect(rows[0]?.getAttribute('href')).toBe(`/notes/${femur.id}?mazo=${femur.deckId}`);
    expect(screen.queryByText('El fémur')).toBeNull(); // la lista no muestra respuestas
    expect(screen.getByRole('link', { name: 'Estudiar este mazo' }).getAttribute('href')).toBe(
      `/study?mazo=${femur.deckId}`,
    );
    expect(screen.getByRole('link', { name: 'Nueva tarjeta' }).getAttribute('href')).toBe(
      `/notes/new?mazo=${femur.deckId}`,
    );
  });

  it('buscar ignora acentos y mayúsculas y también mira la respuesta', async () => {
    const femur = await lowerLimb();
    renderDeck(femur.deckId);
    const search = await screen.findByLabelText('Buscar en este mazo');
    fireEvent.change(search, { target: { value: 'FEMUR' } });
    expect(screen.getByText('1 de 2 tarjetas')).toBeTruthy();
    expect(screen.getByText('¿Hueso del muslo?')).toBeTruthy();
    expect(screen.queryByText('¿Hueso de la rodilla?')).toBeNull();
    fireEvent.change(search, { target: { value: 'húmero' } });
    expect(screen.getByText('Ninguna tarjeta coincide con la búsqueda.')).toBeTruthy();
  });

  it('FE9: con muchas tarjetas solo pinta las visibles, y la búsqueda alcanza las demás', async () => {
    const first = await createNote({ deck: { name: 'Huesos' }, content: basic('Hueso 1') }, { now: T0 });
    for (let i = 2; i <= 150; i += 1) {
      await createNote({ deck: { id: first.deckId }, content: basic(`Hueso ${String(i)}`) }, { now: T0 + i });
    }
    renderDeck(first.deckId);
    await screen.findByText('Hueso 1');
    const items = screen.getAllByRole('listitem').filter((li) => li.getAttribute('aria-setsize') === '150');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(150);
    expect(screen.queryByText('Hueso 140')).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar en este mazo'), { target: { value: 'hueso 140' } });
    expect(screen.getByText('Hueso 140')).toBeTruthy();
  });

  it('editar nombre y descripción; sin nombre, lo pide', async () => {
    const femur = await lowerLimb();
    renderDeck(femur.deckId);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar nombre o borrar' }));
    const name = screen.getByLabelText('Nombre');
    fireEvent.change(name, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Escribe el nombre del mazo.')).toBeTruthy();

    fireEvent.change(name, { target: { value: 'Miembro pélvico' } });
    fireEvent.change(screen.getByLabelText('Descripción (opcional)'), {
      target: { value: 'Parcial de noviembre' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const heading = await screen.findByRole('heading', { name: 'Miembro pélvico' });
    expect(within(heading.parentElement ?? document.body).getByText('Parcial de noviembre')).toBeTruthy();
    expect(await db.decks.get(femur.deckId)).toMatchObject({
      name: 'Miembro pélvico',
      description: 'Parcial de noviembre',
    });
  });

  it('borrar pide confirmación, se lleva sus tarjetas y vuelve a la lista', async () => {
    const femur = await lowerLimb();
    renderDeck(femur.deckId);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar nombre o borrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borrar mazo' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('sus 2 tarjetas');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect((await db.decks.get(femur.deckId))?.deletedAt).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Borrar mazo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar el mazo' }));
    expect(await screen.findByText('Lista de mazos')).toBeTruthy();
    await waitFor(async () => {
      expect((await db.decks.get(femur.deckId))?.deletedAt).not.toBeNull();
      expect((await db.notes.toArray()).every((n) => n.deletedAt !== null)).toBe(true);
    });
  });

  it('"tarjetas" cuenta lo que ella escribió; nuevas, lo que se estudia (un hueco cada una)', async () => {
    const cloze = await createNote({
      deck: { name: 'Brazo' },
      content: { kind: 'cloze', text: 'El {{c1::húmero}} y la {{c2::escápula}}.', explanation: '' },
    });
    renderDeck(cloze.deckId);
    expect(await screen.findByText('1 tarjeta · 0 pendientes · 2 nuevas')).toBeTruthy();
    expect(screen.getByText('El […] y la escápula.')).toBeTruthy(); // sin la respuesta del primer hueco
  });

  it('un mazo que ya no existe lo dice y ofrece volver', async () => {
    renderDeck('0192f1a0-0000-7000-8000-0000000dead0');
    expect(await screen.findByText(/Este mazo ya no existe/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mazos' }).getAttribute('href')).toBe('/decks');
  });
});
