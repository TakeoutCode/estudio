import { cardIdFor } from '@estudio/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { createDeck, setDeckPaused } from './commands';
import { DecksScreen } from './DecksScreen';

const T0 = Date.UTC(2026, 9, 20, 15); // 09:00 en CDMX
const DAY = 86_400_000;

const basic = (front: string) =>
  ({ kind: 'basic', front, back: 'R', explanation: '', reverse: false }) as const;

const renderDecks = () =>
  render(
    <MemoryRouter initialEntries={['/decks']}>
      <Routes>
        <Route path="/decks" element={<DecksScreen />} />
        <Route path="/decks/:deckId" element={<p>Pantalla del mazo</p>} />
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

describe('Mazos (§5)', () => {
  it('lista los mazos por nombre con tarjetas, pendientes y nuevas; "Estudiar" abre solo ese mazo', async () => {
    const vertebra = await createNote(
      { deck: { name: 'Columna' }, content: basic('¿C1?') },
      { now: T0 - DAY },
    );
    await createNote({ deck: { id: vertebra.deckId }, content: basic('¿C2?') }, { now: T0 - DAY });
    // Una de Columna ya aprendida que vence esta noche: cuenta como pendiente de hoy.
    await db.cardStates.put({
      cardId: cardIdFor(vertebra.id, 0),
      due: T0 + 10 * 3_600_000,
      stability: 5,
      difficulty: 5,
      scheduledDays: 5,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      phase: 'review',
      lastReview: T0 - 5 * DAY,
    });
    const empty = await createDeck({ name: 'Anatomía de superficie' }, { now: T0 });

    renderDecks();
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.querySelector('span')?.textContent)).toEqual([
      'Anatomía de superficie',
      'Columna',
    ]);
    const [surfaceItem, columnItem] = items;
    if (!surfaceItem || !columnItem) throw new Error('faltan mazos en la lista');
    const column = within(columnItem);
    expect(column.getByText('2 tarjetas · 1 pendiente · 1 nueva')).toBeTruthy();
    expect(column.getByRole('link', { name: 'Estudiar Columna' }).getAttribute('href')).toBe(
      `/study?mazo=${vertebra.deckId}`,
    );
    const surface = within(surfaceItem);
    expect(surface.getByText('Sin tarjetas todavía')).toBeTruthy();
    expect(surface.queryByRole('link', { name: /Estudiar/ })).toBeNull();
    expect(surface.getByRole('link', { name: /Anatomía de superficie/ }).getAttribute('href')).toBe(
      `/decks/${empty.id}`,
    );
  });

  it('los mazos en pausa van al final, lo dicen y se pueden estudiar igual', async () => {
    const anatomy = await createNote({ deck: { name: 'Anatomía' }, content: basic('¿C1?') }, { now: T0 });
    await createNote({ deck: { name: 'Bioquímica' }, content: basic('¿ATP?') }, { now: T0 });
    await setDeckPaused(anatomy.deckId, true, { now: T0 + 1 });
    renderDecks();
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.querySelector('span')?.textContent)).toEqual(['Bioquímica', 'Anatomía']);
    const paused = items[1];
    if (!paused) throw new Error('falta el mazo en pausa');
    expect(within(paused).getByText('En pausa · 1 tarjeta · 0 pendientes · 1 nueva')).toBeTruthy();
    expect(within(paused).getByRole('link', { name: 'Estudiar Anatomía' })).toBeTruthy();
  });

  it('UX3: sin mazos lo explica y deja crear uno', async () => {
    renderDecks();
    expect(await screen.findByText(/Todavía no tienes mazos/)).toBeTruthy();
    expect(screen.getByLabelText('Nuevo mazo')).toBeTruthy();
  });

  it('crear un mazo lo guarda y lo abre; sin nombre, lo pide', async () => {
    renderDecks();
    const create = await screen.findByRole('button', { name: 'Crear' });
    fireEvent.change(screen.getByLabelText('Nuevo mazo'), { target: { value: '   ' } });
    fireEvent.click(create);
    expect(screen.getByRole('alert').textContent).toBe('Escribe el nombre del mazo nuevo.');
    expect(await db.decks.count()).toBe(0);

    fireEvent.change(screen.getByLabelText('Nuevo mazo'), { target: { value: 'Miología' } });
    fireEvent.click(create);
    expect(await screen.findByText('Pantalla del mazo')).toBeTruthy();
    await waitFor(async () => {
      expect((await db.decks.toArray()).map((d) => d.name)).toEqual(['Miología']);
    });
  });
});
