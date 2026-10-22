import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { saveSelfExplanation } from '@/features/study';
import { TeachScreen } from './TeachScreen';
import { TopicScreen } from './TopicScreen';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/topics/:topicId" element={<TopicScreen />} />
        <Route path="/topics/:topicId/explicar" element={<TeachScreen />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

/** Un tema con su explicación, una tarjeta básica y un cloze de dos huecos. */
async function withTopic() {
  const first = await createNote({
    deck: { name: 'Hombro' },
    content: {
      kind: 'basic',
      front: '¿Nervio del deltoides?',
      back: 'El axilar',
      explanation: '',
      reverse: false,
    },
    topic: { name: 'Plexo braquial', explanation: 'Raíces C5-T1 que se reparten en nervios del brazo.' },
  });
  const topicId = first.topicId ?? '';
  await createNote({
    deck: { id: first.deckId },
    content: {
      kind: 'cloze',
      text: 'El {{c1::axilar}} sale del {{c2::fascículo posterior}}.',
      explanation: '',
    },
    topic: { id: topicId },
  });
  return topicId;
}

describe('"Explícaselo a alguien" (STUDY-METHODS §1)', () => {
  it('se llega desde el tema', async () => {
    const topicId = await withTopic();
    renderAt(`/topics/${topicId}`);
    const link = await screen.findByRole('link', { name: 'Explícaselo a alguien' });
    expect(link.getAttribute('href')).toBe(`/topics/${topicId}/explicar`);
  });

  it('primero lo explica sin ver sus apuntes; al comparar ve la explicación y las preguntas sin respuestas', async () => {
    const topicId = await withTopic();
    renderAt(`/topics/${topicId}/explicar`);
    expect(await screen.findByRole('heading', { name: 'Explícaselo a alguien' })).toBeTruthy();
    expect(screen.getByText('No cuenta como repaso: tus tarjetas siguen igual.')).toBeTruthy();
    // Antes de explicarlo, sus apuntes no están en pantalla.
    expect(screen.queryByText(/Raíces C5-T1/)).toBeNull();
    const compare = screen.getByRole<HTMLButtonElement>('button', { name: 'Comparar con tus apuntes' });
    expect(compare.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Tu explicación'), {
      target: { value: 'Son las raíces del cuello que forman los nervios del brazo.' },
    });
    fireEvent.click(compare);
    const notes = screen.getByRole('region', { name: 'Tus apuntes de este tema' });
    expect(within(notes).getByText(/Raíces C5-T1/)).toBeTruthy();
    expect(within(notes).getByText('¿Lo que explicaste responde estas 2 preguntas?')).toBeTruthy();
    const prompts = within(notes)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    // R1: ni la respuesta de la básica ni ningún hueco del cloze.
    expect(prompts).toEqual(['¿Nervio del deltoides?', 'El […] sale del […].']);
    expect(screen.queryByText(/El axilar$/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Qué te faltó/), { target: { value: 'De qué fascículo sale.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Ya sabes a qué volver/)).toBeTruthy();

    const [saved] = await db.selfExplanations.toArray();
    expect(saved).toMatchObject({
      topicId,
      kind: 'teach',
      text: 'Son las raíces del cuello que forman los nervios del brazo.',
      gaps: 'De qué fascículo sale.',
    });
    // R15: no es un repaso.
    expect(await db.reviewLogs.count()).toBe(0);
    await waitFor(async () => {
      expect((await db.outbox.toArray()).at(-1)).toMatchObject({ entity: 'selfExplanation', op: 'upsert' });
    });
  });

  it('sin lo que le faltó se guarda igual; la próxima vez dice cuándo lo explicó', async () => {
    const topicId = await withTopic();
    await saveSelfExplanation({ topicId, text: 'Con mis palabras' }); // LD5: no cuenta como "explicárselo"
    const { unmount } = renderAt(`/topics/${topicId}/explicar`);
    expect(await screen.findByText('No cuenta como repaso: tus tarjetas siguen igual.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tu explicación'), { target: { value: 'Otra vez' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comparar con tus apuntes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Explicarlo así ayuda/)).toBeTruthy();
    expect((await db.selfExplanations.toArray()).map((e) => [e.kind, e.gaps])).toEqual([
      ['self', null],
      ['teach', null],
    ]);
    unmount();
    renderAt(`/topics/${topicId}/explicar`);
    expect(await screen.findByText(/La última vez lo explicaste el/)).toBeTruthy();
  });

  it('un tema que ya no existe lo dice', async () => {
    renderAt('/topics/0192f1a0-0000-7000-8000-000000000000/explicar');
    expect(await screen.findByText('Este tema ya no existe.')).toBeTruthy();
  });
});
