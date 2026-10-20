import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { TodayScreen } from './TodayScreen';

const content = {
  kind: 'basic',
  front: '¿Hueso más largo?',
  back: 'El fémur',
  explanation: '',
  reverse: false,
} as const;

const renderToday = () =>
  render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

describe('TodayScreen', () => {
  it('UX3: muestra el estado vacío con una salida, sin lenguaje de atraso', async () => {
    const { container } = renderToday();
    expect(screen.getByRole('heading', { name: 'Hoy' })).toBeTruthy();
    expect(await screen.findByText(/No hay tarjetas pendientes/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nueva tarjeta' }).getAttribute('href')).toBe('/notes/new');
    expect(container.textContent).not.toMatch(/atrasad|vencid/i);
  });

  it('con tarjetas nuevas ofrece empezar la sesión', async () => {
    await createNote({ deck: { name: 'Huesos' }, content });
    renderToday();
    expect(await screen.findByText('Y 1 nueva para aprender')).toBeTruthy();
    expect(screen.getByText('Hoy no hay repasos pendientes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Empezar' }).getAttribute('href')).toBe('/study');
  });
});
