import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { TopicScreen } from './TopicScreen';

const renderTopic = (topicId: string) =>
  render(
    <MemoryRouter initialEntries={[`/topics/${topicId}`]}>
      <Routes>
        <Route path="/topics/:topicId" element={<TopicScreen />} />
        <Route path="/decks/:deckId" element={<p>Pantalla del mazo</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

async function withTopic() {
  return createNote({
    deck: { name: 'Hombro' },
    content: {
      kind: 'basic',
      front: '¿Nervio del deltoides?',
      back: 'El axilar',
      explanation: '',
      reverse: false,
    },
    topic: { name: 'Plexo braquial', explanation: 'Raíces C5-T1.' },
  });
}

describe('tema (LD5)', () => {
  it('"Volver al mazo" va al mazo del tema, venga de donde venga', async () => {
    const note = await withTopic();
    renderTopic(note.topicId ?? '');
    const back = await screen.findByRole('link', { name: 'Volver al mazo' });
    expect(back.getAttribute('href')).toBe(`/decks/${note.deckId}`);
  });

  it('borrar pide confirmación; sus tarjetas se quedan sin tema y vuelve al mazo', async () => {
    const note = await withTopic();
    renderTopic(note.topicId ?? '');
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar tema' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('sus tarjetas se quedan, sin tema');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect((await db.topics.get(note.topicId ?? ''))?.deletedAt).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Borrar tema' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar el tema' }));
    expect(await screen.findByText('Pantalla del mazo')).toBeTruthy();
    await waitFor(async () => {
      expect((await db.topics.get(note.topicId ?? ''))?.deletedAt).not.toBeNull();
      expect(await db.notes.get(note.id)).toMatchObject({ deletedAt: null, topicId: null });
    });
  });

  it('un tema que ya no existe lo dice y ofrece volver a Mazos', async () => {
    renderTopic('0192f1a0-0000-7000-8000-0000000dead0');
    expect(await screen.findByText('Este tema ya no existe.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mazos' }).getAttribute('href')).toBe('/decks');
  });
});
