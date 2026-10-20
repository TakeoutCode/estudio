import { type NoteContent, Rating } from '@estudio/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { useStudy } from './store';
import { StudyScreen } from './StudyScreen';

const T0 = Date.UTC(2026, 9, 20, 15);

const renderStudy = () =>
  render(
    <MemoryRouter initialEntries={['/study']}>
      <StudyScreen />
    </MemoryRouter>,
  );

const only = (content: NoteContent) => createNote({ deck: { name: 'Brazo' }, content }, { now: T0 - 1 });
const logs = () => db.reviewLogs.toArray();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  useStudy.getState().end();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('huecos (cloze, LD §1)', () => {
  it('R1: el hueco no muestra su respuesta antes de revelar; después sí, y ella califica', async () => {
    await only({ kind: 'cloze', text: 'El {{c1::nervio axilar}} inerva el deltoides.', explanation: '' });
    const { container } = renderStudy();
    expect(await screen.findByText('…')).toBeTruthy();
    expect(container.textContent).not.toContain('nervio axilar');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    expect(screen.getByText('nervio axilar')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Otra vez|Difícil|Bien|Fácil/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ cardKind: 'cloze', rating: Rating.Good }]);
    });
  });
});

describe('escribir la respuesta (type_answer, LD2)', () => {
  const typed: NoteContent = {
    kind: 'type_answer',
    front: '¿Qué nervio inerva el bíceps braquial?',
    back: 'Musculocutáneo',
    explanation: 'Sale del fascículo lateral.',
  };

  it('LD2: un error es Again fijo y siempre muestra la ortografía correcta', async () => {
    await only(typed);
    const { container } = renderStudy();
    await screen.findByText('¿Qué nervio inerva el bíceps braquial?');
    expect(container.textContent).not.toContain('Musculocutáneo'); // R1
    fireEvent.change(screen.getByLabelText('Escribe tu respuesta'), { target: { value: 'radial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    expect(screen.getByText('No coincide.')).toBeTruthy();
    expect(screen.getByText('Musculocutáneo')).toBeTruthy();
    expect(screen.getByText('Sale del fascículo lateral.')).toBeTruthy(); // R4
    expect(screen.queryByRole('button', { name: 'Bien' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        { cardKind: 'type_answer', rating: Rating.Again, answer: { text: 'radial' } },
      ]);
    });
  });

  it('LD2: sin distinguir acentos ni mayúsculas; con acierto elige entre Difícil, Bien y Fácil', async () => {
    await only(typed);
    renderStudy();
    fireEvent.change(await screen.findByLabelText('Escribe tu respuesta'), {
      target: { value: ' musculocutaneo ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    expect(screen.getByText('Correcto.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Otra vez' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' }); // Good por defecto
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ rating: Rating.Good, answer: { text: 'musculocutaneo' } }]);
    });
  });

  it('R6: con confianza en repasos, se pide antes de escribir', async () => {
    await only(typed);
    renderStudy();
    await screen.findByText('¿Qué nervio inerva el bíceps braquial?');
    useStudy.setState((s) => ({ session: s.session ? { ...s.session, askConfidence: true } : null }));
    fireEvent.click(await screen.findByRole('button', { name: 'Algo' }));
    fireEvent.change(screen.getByLabelText('Escribe tu respuesta'), { target: { value: 'Musculocutáneo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fácil' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ rating: Rating.Easy, confidence: 2 }]);
    });
  });
});

describe('opción múltiple (LD2)', () => {
  it('R1: antes de elegir nada dice cuál es la correcta; elegir es el intento', async () => {
    await only({
      kind: 'multiple_choice',
      question: '¿Qué nervio pasa por el surco radial?',
      options: ['Mediano', 'Radial', 'Cubital'],
      correct: 1,
      explanation: '',
    });
    renderStudy();
    await screen.findByText('¿Qué nervio pasa por el surco radial?');
    expect(screen.queryByText('correcta')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Mediano/ }));
    expect(screen.getByText('No era esa opción.')).toBeTruthy();
    expect(screen.getByText('correcta')).toBeTruthy();
    expect(screen.getByText('tu elección')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        { cardKind: 'multiple_choice', rating: Rating.Again, answer: { option: 0 } },
      ]);
    });
  });
});
