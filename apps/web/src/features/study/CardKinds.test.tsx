import { newId, type NoteContent, Rating } from '@estudio/shared';
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

describe('imagen con etiquetas (image_occlusion, R10, LD1)', () => {
  const occlusion = (imageAssetId: string, mode: 'hide_all' | 'hide_one', labels: readonly string[]) =>
    ({
      kind: 'image_occlusion',
      imageAssetId,
      prompt: '¿Qué hueso del carpo es?',
      alt: 'Mano derecha, vista palmar',
      mode,
      groups: labels.map((label, i) => ({
        n: i + 1,
        label,
        rects: [{ x: 0.1 + i * 0.3, y: 0.3, w: 0.2, h: 0.1 }],
      })),
      explanation: 'El más lateral de la fila proximal.',
    }) satisfies NoteContent;

  const withImage = async (mode: 'hide_all' | 'hide_one', labels: readonly string[]) => {
    const assetId = newId();
    const image = {
      assetId,
      data: new Uint8Array([1, 2]).buffer,
      mime: 'image/png' as const,
      width: 800,
      height: 600,
    };
    await createNote(
      { deck: { name: 'Mano' }, content: occlusion(assetId, mode, labels), image },
      { now: T0 - 1 },
    );
  };

  beforeEach(() => {
    // jsdom no tiene URLs blob: la imagen sin subir se muestra desde una falsa.
    URL.createObjectURL = vi.fn(() => 'blob:copia-local');
    URL.revokeObjectURL = vi.fn();
  });

  it('R1: la etiqueta va tapada y su nombre no está en el DOM; tocarla revela, con explicación (R4)', async () => {
    await withImage('hide_all', ['Escafoides']);
    const { container } = renderStudy();
    expect(await screen.findByRole('img', { name: 'Mano derecha, vista palmar' })).toBeTruthy();
    const mask = screen.getByRole('button', { name: 'Etiqueta oculta 1 de 1' });
    expect(container.textContent).not.toContain('Escafoides');
    fireEvent.click(mask);
    expect(screen.getByText('Escafoides')).toBeTruthy();
    expect(screen.getByText('El más lateral de la fila proximal.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Etiqueta oculta 1 de 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ cardKind: 'image_occlusion', rating: Rating.Good }]);
    });
  });

  it('hide_all tapa también las otras etiquetas sin nombrarlas; hide_one las deja a la vista', async () => {
    await withImage('hide_all', ['Escafoides', 'Semilunar']);
    const first = renderStudy();
    await screen.findByRole('button', { name: /Etiqueta oculta \d de 2/ });
    expect(screen.getAllByRole('img', { name: 'Otra etiqueta oculta' })).toHaveLength(1);
    expect(first.container.textContent).not.toMatch(/Escafoides|Semilunar/);
    first.unmount();
    await db.delete({ disableAutoOpen: false });
    useStudy.getState().end();

    await withImage('hide_one', ['Escafoides', 'Semilunar']);
    renderStudy();
    await screen.findByRole('button', { name: /Etiqueta oculta \d de 2/ });
    expect(screen.queryAllByRole('img', { name: 'Otra etiqueta oculta' })).toHaveLength(0);
  });

  it('R6: con confianza en repasos, la etiqueta no es un botón; elegir la confianza revela', async () => {
    await withImage('hide_all', ['Escafoides']);
    const { container } = renderStudy();
    await screen.findByRole('button', { name: 'Etiqueta oculta 1 de 1' });
    useStudy.setState((s) => ({ session: s.session ? { ...s.session, askConfidence: true } : null }));
    expect(await screen.findByRole('img', { name: 'Etiqueta oculta 1 de 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Etiqueta oculta 1 de 1' })).toBeNull();
    expect(container.textContent).not.toContain('Escafoides');
    fireEvent.click(screen.getByRole('button', { name: 'Mucha' }));
    expect(screen.getByText('Escafoides')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fácil' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        { cardKind: 'image_occlusion', rating: Rating.Easy, confidence: 3 },
      ]);
    });
  });
});
