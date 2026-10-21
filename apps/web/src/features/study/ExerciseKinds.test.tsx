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

const only = (content: NoteContent) => createNote({ deck: { name: 'Hombro' }, content }, { now: T0 - 1 });
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

describe('verdadero o falso con justificación (LD §2, LD2)', () => {
  const tfj: NoteContent = {
    kind: 'true_false_justify',
    statement: 'El nervio radial inerva el deltoides.',
    isTrue: false,
    justification: 'Lo inerva el axilar, que rodea el cuello quirúrgico del húmero.',
    explanation: 'El radial inerva los extensores.',
  };

  /** Elige V/F, justifica y comprueba. */
  const attempt = async (verdict: 'Verdadera' | 'Falsa', justification: string) => {
    const check = await screen.findByRole('button', { name: 'Comprobar' });
    expect(check.hasAttribute('disabled')).toBe(true); // falta el V/F y la justificación
    fireEvent.click(screen.getByRole('button', { name: verdict }));
    fireEvent.change(screen.getByLabelText('¿Por qué? Justifica con tus palabras'), {
      target: { value: justification },
    });
    fireEvent.click(check);
  };

  it('R1: la justificación de referencia no está en el DOM antes del intento; un V/F errado es Again', async () => {
    await only(tfj);
    const { container } = renderStudy();
    await screen.findByText('El nervio radial inerva el deltoides.');
    expect(container.textContent).not.toContain('Lo inerva el axilar');
    await attempt('Verdadera', 'Porque pasa por el surco radial.');
    expect(screen.getByText('No: la afirmación es falsa.')).toBeTruthy();
    expect(screen.getByText('Porque pasa por el surco radial.')).toBeTruthy();
    expect(screen.getByText(/Lo inerva el axilar/)).toBeTruthy();
    expect(screen.getByText('El radial inerva los extensores.')).toBeTruthy(); // R4
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        {
          cardKind: 'true_false_justify',
          rating: Rating.Again,
          answer: { verdict: true, justification: 'Porque pasa por el surco radial.' },
        },
      ]);
    });
  });

  it('LD2: con el V/F acertado ella juzga su justificación: suficiente es Good, débil es Hard', async () => {
    await only(tfj);
    renderStudy();
    await attempt('Falsa', 'Es el axilar.');
    expect(screen.getByText('Correcto: la afirmación es falsa.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fácil' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Le faltó algo' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ rating: Rating.Hard }]);
    });
  });
});

describe('pregunta abierta (LD §2, LD2)', () => {
  const open: NoteContent = {
    kind: 'open_question',
    question: '¿Por qué una fractura del cuello quirúrgico puede debilitar la abducción?',
    key: 'Puede lesionar el nervio axilar, que inerva el deltoides.',
    explanation: '',
  };

  it('R1: escribe antes de ver la clave; luego se califica con los 4 botones y Enter no elige por ella', async () => {
    await only(open);
    const { container } = renderStudy();
    const showKey = await screen.findByRole('button', { name: 'Ver la clave' });
    expect(container.textContent).not.toContain('nervio axilar');
    expect(showKey.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Escribe tu respuesta antes de ver la clave'), {
      target: { value: 'Por el nervio axilar.' },
    });
    fireEvent.click(showKey);
    expect(screen.getByText('Puede lesionar el nervio axilar, que inerva el deltoides.')).toBeTruthy();
    expect(screen.getByText('Compárala con la clave: ¿cómo te fue?')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Otra vez|Difícil|Bien|Fácil/ })).toHaveLength(4);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await logs()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        { cardKind: 'open_question', rating: Rating.Good, answer: { text: 'Por el nervio axilar.' } },
      ]);
    });
  });
});
