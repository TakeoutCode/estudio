import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('editor de notas · etiquetas', () => {
  it('Enter agrega la etiqueta sin guardar; las que ya tiene se sugieren; se guardan con la nota', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await createNote({
      deck: { name: 'Carpo' },
      content: { kind: 'basic', front: '¿Grande?', back: 'El hueso grande', explanation: '', reverse: false },
      tags: [{ name: 'Parcial 2' }],
    });
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Pregunta'), { target: { value: '¿Ganchoso?' } });
    fireEvent.change(screen.getByLabelText('Respuesta'), { target: { value: 'El hamato' } });
    const input = await screen.findByRole('textbox', { name: 'Agregar etiqueta' });
    fireEvent.change(input, { target: { value: 'Mano' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Quitar la etiqueta Mano' })).toBeTruthy();
    expect(await db.notes.count()).toBe(1); // Enter no guardó la nota
    fireEvent.click(screen.getByRole('button', { name: 'Parcial 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect(await db.notes.count()).toBe(2);
    });
    const tags = await db.tags.toArray();
    const saved = (await db.notes.toArray()).find(
      (n) => n.content.kind === 'basic' && n.content.front === '¿Ganchoso?',
    );
    expect(saved?.tagIds.map((id) => tags.find((t) => t.id === id)?.name).sort()).toEqual([
      'Mano',
      'Parcial 2',
    ]);
    // La siguiente nota conserva las etiquetas, como el mazo y el tema.
    expect(screen.getByRole('button', { name: 'Quitar la etiqueta Mano' })).toBeTruthy();
  });
});

describe('editor de notas · ejercicios (?tipo=ejercicio, LD §2)', () => {
  const renderExercise = (path = '/notes/new?tipo=ejercicio') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/notes/new" element={<NoteEditorScreen />} />
          <Route path="/notes/:noteId" element={<NoteEditorScreen />} />
        </Routes>
      </MemoryRouter>,
    );

  it('ofrece los tipos de ejercicio; V/F pide la afirmación, el valor y la justificación', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await createDeck({ name: 'Hombro' });
    renderExercise();
    expect(await screen.findByRole('heading', { name: 'Nuevo ejercicio' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verdadero o falso' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Pregunta abierta' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Huecos' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Afirmación'), {
      target: { value: 'El radial inerva el deltoides.' },
    });
    fireEvent.change(screen.getByLabelText('Justificación de referencia'), {
      target: { value: 'Es el axilar.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/elige si es verdadera o falsa/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Falsa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray()).map((n) => n.content)).toEqual([
        {
          kind: 'true_false_justify',
          statement: 'El radial inerva el deltoides.',
          isTrue: false,
          justification: 'Es el axilar.',
          explanation: '',
        },
      ]);
    });
  });

  it('un ejercicio guardado se abre en su editor, con sus campos', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    const note = await createNote({
      deck: { name: 'Hombro' },
      content: { kind: 'open_question', question: '¿Por qué?', key: 'Por el axilar.', explanation: '' },
    });
    renderExercise(`/notes/${note.id}`);
    expect(await screen.findByRole('heading', { name: 'Editar ejercicio' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Clave de respuesta').value).toBe('Por el axilar.');
  });
});

describe('editor de notas · ordenar (sequence)', () => {
  it('escribe los elementos en orden; se reordenan con las flechas y se quitan', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await createDeck({ name: 'Piel' });
    render(
      <MemoryRouter initialEntries={['/notes/new?tipo=ejercicio']}>
        <NoteEditorScreen />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ordenar' }));
    fireEvent.change(screen.getByLabelText('Consigna'), { target: { value: 'De superficial a profunda.' } });
    fireEvent.change(screen.getByLabelText('Elemento 1'), { target: { value: 'Dermis' } });
    fireEvent.change(screen.getByLabelText('Elemento 2'), { target: { value: 'Epidermis' } });
    fireEvent.change(screen.getByLabelText('Elemento 3'), { target: { value: 'Hipodermis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar elemento' }));
    fireEvent.change(screen.getByLabelText('Elemento 4'), { target: { value: 'Músculo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Subir: Epidermis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el elemento 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray()).map((n) => n.content)).toEqual([
        {
          kind: 'sequence',
          prompt: 'De superficial a profunda.',
          items: ['Epidermis', 'Dermis', 'Hipodermis'],
          explanation: '',
        },
      ]);
    });
  });
});

describe('editor de notas · relacionar columnas (matching)', () => {
  it('pares en dos columnas; un par a medias no se guarda', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await createDeck({ name: 'Brazo' });
    render(
      <MemoryRouter initialEntries={['/notes/new?tipo=ejercicio']}>
        <NoteEditorScreen />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Relacionar columnas' }));
    fireEvent.change(screen.getByLabelText('Consigna'), { target: { value: 'Músculo e inervación.' } });
    const rows = [
      ['Deltoides', 'Axilar'],
      ['Bíceps braquial', 'Musculocutáneo'],
      ['Tríceps braquial', ''],
    ] as const;
    rows.forEach(([left, right], i) => {
      fireEvent.change(screen.getByLabelText(`Columna A, par ${String(i + 1)}`), { target: { value: left } });
      fireEvent.change(screen.getByLabelText(`Columna B, par ${String(i + 1)}`), {
        target: { value: right },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/de 3 a 8 pares completos/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Columna B, par 3'), { target: { value: 'Radial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray()).map((n) => n.content)).toEqual([
        {
          kind: 'matching',
          prompt: 'Músculo e inervación.',
          pairs: [
            { left: 'Deltoides', right: 'Axilar' },
            { left: 'Bíceps braquial', right: 'Musculocutáneo' },
            { left: 'Tríceps braquial', right: 'Radial' },
          ],
          explanation: '',
        },
      ]);
    });
  });
});

describe('editor de notas · etiquetar una imagen (label_image)', () => {
  beforeEach(() => {
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

  it('usa el editor de oclusión sin el modo; guarda las etiquetas y la imagen', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    render(
      <MemoryRouter initialEntries={['/notes/new?tipo=ejercicio']}>
        <NoteEditorScreen />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Etiquetar imagen' }));
    fireEvent.change(screen.getByLabelText('Nombre del mazo nuevo'), { target: { value: 'Mano' } });
    fireEvent.change(screen.getByLabelText('Elegir imagen'), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'carpo.png', { type: 'image/png' })] },
    });
    expect(await screen.findByRole('group', { name: 'Imagen para tapar etiquetas' })).toBeTruthy();
    expect(screen.queryByLabelText('Tapar también las demás')).toBeNull();
    expect(screen.getByText(/Al estudiar se tapan todas, numeradas/)).toBeTruthy();
    for (const [i, name] of ['Escafoides', 'Semilunar'].entries()) {
      fireEvent.click(screen.getByRole('button', { name: 'Agregar recuadro' }));
      fireEvent.change(screen.getByLabelText(`Nombre de la etiqueta ${String(i + 1)}`), {
        target: { value: name },
      });
    }
    fireEvent.change(screen.getByLabelText('Pregunta que acompaña la imagen'), {
      target: { value: 'Nombra los huesos marcados.' },
    });
    fireEvent.change(screen.getByLabelText('Descripción de la imagen'), {
      target: { value: 'Mano derecha, vista palmar' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      const [note] = await db.notes.toArray();
      expect(note?.content).toMatchObject({
        kind: 'label_image',
        prompt: 'Nombra los huesos marcados.',
        labels: [
          { n: 1, label: 'Escafoides' },
          { n: 2, label: 'Semilunar' },
        ],
      });
      expect(await db.pendingUploads.count()).toBe(1);
    });
  });
});

describe('editor de notas · caso clínico (clinical_case)', () => {
  it('el caso y sus preguntas, cada una de su tipo; quitar una no reusa su número', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await createDeck({ name: 'Mano' });
    render(
      <MemoryRouter initialEntries={['/notes/new?tipo=ejercicio']}>
        <NoteEditorScreen />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Caso clínico' }));
    fireEvent.change(screen.getByLabelText('Caso'), { target: { value: 'Caída sobre la mano extendida.' } });
    // Pregunta 1: opción múltiple.
    fireEvent.change(screen.getAllByLabelText('Pregunta')[0] ?? document.body, {
      target: { value: '¿Qué hueso?' },
    });
    ['Escafoides', 'Semilunar', 'Pisiforme'].forEach((option, i) => {
      fireEvent.change(screen.getByLabelText(`Opción ${String(i + 1)}`), { target: { value: option } });
    });
    fireEvent.click(screen.getByLabelText('La opción 1 es la correcta'));
    // Pregunta 2 (se quita) y 3: escribir.
    fireEvent.click(screen.getByRole('button', { name: 'Agregar pregunta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar pregunta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar la pregunta 2' }));
    const last = screen.getByRole('group', { name: 'Pregunta 2' });
    fireEvent.click(within(last).getByRole('button', { name: 'Escribir' }));
    fireEvent.change(within(last).getByLabelText('Pregunta'), { target: { value: '¿Qué arteria?' } });
    fireEvent.change(within(last).getByLabelText('Respuesta (corta)'), { target: { value: 'Radial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray()).map((n) => n.content)).toEqual([
        {
          kind: 'clinical_case',
          vignette: 'Caída sobre la mano extendida.',
          questions: [
            {
              n: 1,
              type: 'multiple_choice',
              question: '¿Qué hueso?',
              options: ['Escafoides', 'Semilunar', 'Pisiforme'],
              correct: 0,
            },
            { n: 3, type: 'type_answer', question: '¿Qué arteria?', answer: 'Radial' },
          ],
          explanation: '',
        },
      ]);
    });
  });
});
