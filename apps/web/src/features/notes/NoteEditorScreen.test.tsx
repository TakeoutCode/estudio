import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createDeck } from '@/features/decks';
import { createNote } from './commands';
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

describe('editor de notas · desde un mazo (?mazo=)', () => {
  it('preselecciona ese mazo, guarda ahí y "Volver al mazo" regresa a él', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    const [first, second] = [await createDeck({ name: 'Carpo' }), await createDeck({ name: 'Tarso' })];
    render(
      <MemoryRouter initialEntries={[`/notes/new?mazo=${first.id}`]}>
        <Routes>
          <Route path="/notes/new" element={<NoteEditorScreen />} />
          <Route path="/decks/:deckId" element={<p>Pantalla del mazo</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByLabelText<HTMLSelectElement>('Mazo')).value).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    fireEvent.change(screen.getByLabelText('Pregunta'), { target: { value: '¿Hueso en forma de barco?' } });
    fireEvent.change(screen.getByLabelText('Respuesta'), { target: { value: 'El escafoides' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray()).map((n) => n.deckId)).toEqual([first.id]);
    });
    fireEvent.click(screen.getByRole('link', { name: 'Volver al mazo' }));
    expect(await screen.findByText('Pantalla del mazo')).toBeTruthy();
  });

  it('al editar se puede mover a otro mazo: lo avisa y la deja sin tema', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    const note = await createNote({
      deck: { name: 'Carpo' },
      content: { kind: 'basic', front: '¿Escafoides?', back: 'Carpo', explanation: '', reverse: false },
      topic: { name: 'Fila proximal', explanation: '' },
    });
    const tarsus = await createDeck({ name: 'Tarso' });
    render(
      <MemoryRouter initialEntries={[`/notes/${note.id}`]}>
        <Routes>
          <Route path="/notes/:noteId" element={<NoteEditorScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    const deck = await screen.findByLabelText<HTMLSelectElement>('Mazo');
    expect(deck.value).toBe(note.deckId);
    expect(screen.queryByText(/pasa a ese mazo con todo su historial/)).toBeNull();
    fireEvent.change(deck, { target: { value: tarsus.id } });
    expect(screen.getByText(/pasa a ese mazo con todo su historial/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Tema (opcional)').value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect(await db.notes.get(note.id)).toMatchObject({ deckId: tarsus.id, topicId: null });
    });
    expect(screen.queryByText(/pasa a ese mazo con todo su historial/)).toBeNull();
  });

  it('borrar pide confirmación; al confirmar borra y vuelve al mazo de donde vino', async () => {
    const note = await createNote({
      deck: { name: 'Carpo' },
      content: { kind: 'basic', front: '¿Semilunar?', back: 'Carpo', explanation: '', reverse: false },
    });
    render(
      <MemoryRouter initialEntries={[`/notes/${note.id}?mazo=${note.deckId}`]}>
        <Routes>
          <Route path="/notes/:noteId" element={<NoteEditorScreen />} />
          <Route path="/decks/:deckId" element={<p>Pantalla del mazo</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar tarjeta' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('No se puede deshacer');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect((await db.notes.get(note.id))?.deletedAt).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Borrar tarjeta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar la tarjeta' }));
    expect(await screen.findByText('Pantalla del mazo')).toBeTruthy();
    expect((await db.notes.get(note.id))?.deletedAt).not.toBeNull();
  });

  it('un ?mazo= que no existe se ignora: vuelve a Hoy', async () => {
    render(
      <MemoryRouter initialEntries={['/notes/new?mazo=0192f1a0-0000-7000-8000-0000000dead0']}>
        <NoteEditorScreen />
      </MemoryRouter>,
    );
    expect((await screen.findByRole('link', { name: 'Volver a Hoy' })).getAttribute('href')).toBe('/');
  });
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

describe('editor de notas · imagen con etiquetas (R10, LD1)', () => {
  beforeEach(() => {
    // jsdom no decodifica imágenes ni crea URLs blob.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 800, height: 600, close: vi.fn() })),
    );
    URL.createObjectURL = vi.fn(() => 'blob:vista-previa');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pick = (file: File) => {
    fireEvent.change(screen.getByLabelText('Elegir imagen'), { target: { files: [file] } });
  };

  it('elige la imagen, tapa una etiqueta con el teclado, la nombra y guarda nota e imagen', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Imagen con etiquetas' }));
    fireEvent.change(screen.getByLabelText('Nombre del mazo nuevo'), { target: { value: 'Mano' } });
    pick(new File([new Uint8Array([1, 2, 3])], 'carpo.png', { type: 'image/png' }));
    expect(await screen.findByRole('group', { name: 'Imagen para tapar etiquetas' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Agregar recuadro' }));
    const rect = screen.getByRole('button', { name: 'Recuadro de la etiqueta 1' });
    fireEvent.keyDown(rect, { key: 'ArrowRight' });
    fireEvent.keyDown(rect, { key: 'ArrowDown', shiftKey: true });
    fireEvent.change(screen.getByLabelText('Pregunta que acompaña la imagen'), {
      target: { value: '¿Qué hueso es?' },
    });
    fireEvent.change(screen.getByLabelText('Descripción de la imagen'), {
      target: { value: 'Mano derecha, vista palmar' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    // Sin nombre en la etiqueta no se guarda.
    expect(screen.getByText(/ponle nombre a cada una/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nombre de la etiqueta 1'), { target: { value: 'Escafoides' } });
    fireEvent.click(screen.getByLabelText('Dejar las demás a la vista'));
    fireEvent.click(screen.getByLabelText('Tapar también las demás'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(async () => {
      const [note] = await db.notes.toArray();
      expect(note?.content).toMatchObject({
        kind: 'image_occlusion',
        prompt: '¿Qué hueso es?',
        alt: 'Mano derecha, vista palmar',
        mode: 'hide_all',
        groups: [{ n: 1, label: 'Escafoides', rects: [{ x: 0.41, y: 0.45, w: 0.2, h: 0.11 }] }],
      });
      const imageAssetId = note?.content.kind === 'image_occlusion' ? note.content.imageAssetId : '';
      expect(await db.mediaAssets.get(imageAssetId)).toMatchObject({
        width: 800,
        height: 600,
        publicId: null,
      });
      expect(await db.pendingUploads.count()).toBe(1);
    });
  });

  it('avisa si el formato no sirve o pasa de 10 MB, sin abrir el editor', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Imagen con etiquetas' }));
    pick(new File(['<svg/>'], 'dibujo.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('formato'),
    );
    pick(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'grande.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText(/más de 10 MB/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Imagen para tapar etiquetas' })).toBeNull();
  });
});
