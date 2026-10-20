import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { NoteEditorScreen } from './NoteEditorScreen';

const renderEditor = () =>
  render(
    <MemoryRouter initialEntries={['/notes/new']}>
      <NoteEditorScreen />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

describe('editor de notas · tipos de LD §1', () => {
  it('huecos: "Ocultar lo seleccionado" marca el hueco y cada número es una tarjeta', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Huecos' }));
    fireEvent.change(screen.getByLabelText('Nombre del mazo nuevo'), { target: { value: 'Brazo' } });
    const text = screen.getByLabelText<HTMLTextAreaElement>('Texto');
    fireEvent.change(text, { target: { value: 'El nervio axilar inerva el deltoides.' } });
    text.setSelectionRange(3, 16); // "nervio axilar"
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar lo seleccionado' }));
    expect(text.value).toBe('El {{c1::nervio axilar}} inerva el deltoides.');
    expect(screen.getByText('1 hueco: 1 tarjeta.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(async () => {
      expect((await db.notes.toArray())[0]?.content).toEqual({
        kind: 'cloze',
        text: 'El {{c1::nervio axilar}} inerva el deltoides.',
        explanation: '',
      });
    });
    expect((await db.cards.toArray()).map((c) => c.ordinal)).toEqual([1]);
  });

  it('huecos: sin hueco marcado no guarda y lo explica', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Huecos' }));
    fireEvent.change(screen.getByLabelText('Nombre del mazo nuevo'), { target: { value: 'Brazo' } });
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'Sin huecos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Marca al menos un hueco en el texto.')).toBeTruthy();
    expect(await db.notes.count()).toBe(0);
  });

  it('opción múltiple: las opciones vacías no cuentan y la correcta conserva su lugar', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Opción múltiple' }));
    fireEvent.change(screen.getByLabelText('Nombre del mazo nuevo'), { target: { value: 'Brazo' } });
    fireEvent.change(screen.getByLabelText('Pregunta'), { target: { value: '¿Nervio del deltoides?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar opción' }));
    fireEvent.change(screen.getByLabelText('Opción 1'), { target: { value: 'Radial' } });
    fireEvent.change(screen.getByLabelText('Opción 3'), { target: { value: 'Axilar' } });
    fireEvent.change(screen.getByLabelText('Opción 4'), { target: { value: 'Mediano' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      screen.getByText('Escribe la pregunta y entre 3 y 5 opciones distintas, y marca la correcta.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('La opción 3 es la correcta'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(async () => {
      expect((await db.notes.toArray())[0]?.content).toEqual({
        kind: 'multiple_choice',
        question: '¿Nervio del deltoides?',
        options: ['Radial', 'Axilar', 'Mediano'],
        correct: 1,
        explanation: '',
      });
    });
  });

  it('escribir respuesta: pregunta y respuesta corta', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Escribir respuesta' }));
    fireEvent.change(screen.getByLabelText('Nombre del mazo nuevo'), { target: { value: 'Brazo' } });
    fireEvent.change(screen.getByLabelText('Pregunta'), { target: { value: '¿Hueso del pulgar?' } });
    fireEvent.change(screen.getByLabelText('Respuesta (corta)'), { target: { value: 'Trapecio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray())[0]?.content).toMatchObject({ kind: 'type_answer', back: 'Trapecio' });
    });
  });
});
