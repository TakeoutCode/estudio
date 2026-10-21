import { newId, type NoteContent, Rating } from '@estudio/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('ordenar (sequence, LD §2, LD2)', () => {
  const layers: NoteContent = {
    kind: 'sequence',
    prompt: 'Ordena las capas de la piel, de superficial a profunda.',
    items: ['Epidermis', 'Dermis', 'Hipodermis', 'Fascia'],
    explanation: 'La hipodermis es tejido adiposo.',
  };

  /** El orden que se ve en el tablero. */
  const shown = () =>
    within(screen.getByRole('region', { name: 'Elementos para ordenar' }))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('span:not([aria-hidden])')?.textContent ?? '');

  /** Sube cada elemento hasta su lugar con los botones, como lo haría ella. */
  const arrange = (target: readonly string[]) => {
    target.forEach((item, i) => {
      while (shown().indexOf(item) > i)
        fireEvent.click(screen.getByRole('button', { name: `Subir: ${item}` }));
    });
  };

  it('R1: empieza mezclado; ordenado del todo es Good o Fácil, y el orden queda en el log', async () => {
    await only(layers);
    renderStudy();
    await screen.findByText('Ordena las capas de la piel, de superficial a profunda.');
    expect(shown()).not.toEqual(['Epidermis', 'Dermis', 'Hipodermis', 'Fascia']);
    expect(screen.queryByText('Orden correcto')).toBeNull();
    arrange(['Epidermis', 'Dermis', 'Hipodermis', 'Fascia']);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar orden' }));
    expect(screen.getByText('Todo en orden.')).toBeTruthy();
    expect(screen.getAllByText('en su lugar')).toHaveLength(4);
    expect(screen.getByText('La hipodermis es tejido adiposo.')).toBeTruthy(); // R4
    expect(screen.queryByRole('button', { name: 'Difícil' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fácil' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        {
          cardKind: 'sequence',
          rating: Rating.Easy,
          answer: { order: ['Epidermis', 'Dermis', 'Hipodermis', 'Fascia'] },
        },
      ]);
    });
  });

  it('LD2: con un par al revés (s = 5/6, entre 0.8 y 1) es Hard y solo queda seguir', async () => {
    await only(layers);
    renderStudy();
    await screen.findByText('Ordena las capas de la piel, de superficial a profunda.');
    arrange(['Dermis', 'Epidermis', 'Hipodermis', 'Fascia']);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar orden' }));
    expect(screen.getByText('1 par quedó al revés.')).toBeTruthy();
    expect(screen.getByText('lo pusiste en el 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ rating: Rating.Hard }]);
    });
  });
});

describe('ordenar · al revés', () => {
  it('LD2: con el orden invertido (s = 0) es Again', async () => {
    await only({
      kind: 'sequence',
      prompt: 'Ordena de proximal a distal.',
      items: ['Húmero', 'Radio', 'Escafoides'],
      explanation: '',
    });
    renderStudy();
    await screen.findByText('Ordena de proximal a distal.');
    const shown = () =>
      within(screen.getByRole('region', { name: 'Elementos para ordenar' }))
        .getAllByRole('listitem')
        .map((li) => li.querySelector('span:not([aria-hidden])')?.textContent ?? '');
    ['Escafoides', 'Radio', 'Húmero'].forEach((item, i) => {
      while (shown().indexOf(item) > i)
        fireEvent.click(screen.getByRole('button', { name: `Subir: ${item}` }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar orden' }));
    expect(screen.getByText('3 pares quedaron al revés.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ rating: Rating.Again }]);
    });
  });
});

describe('relacionar columnas (matching, LD §2, LD2)', () => {
  const nerves: NoteContent = {
    kind: 'matching',
    prompt: 'Relaciona cada músculo con su inervación.',
    pairs: [
      { left: 'Deltoides', right: 'Axilar' },
      { left: 'Bíceps braquial', right: 'Musculocutáneo' },
      { left: 'Tríceps braquial', right: 'Radial' },
      { left: 'Pronador redondo', right: 'Mediano' },
    ],
    explanation: '',
  };
  const pick = (left: string, right: string) => {
    fireEvent.change(screen.getByLabelText(left), { target: { value: right } });
  };

  it('R1: comprobar espera a que todos tengan pareja; todos bien es Good o Fácil', async () => {
    await only(nerves);
    renderStudy();
    await screen.findByText('Relaciona cada músculo con su inervación.');
    const check = screen.getByRole('button', { name: 'Comprobar' });
    expect(screen.getByText('Faltan 4 por relacionar')).toBeTruthy();
    pick('Deltoides', 'Axilar');
    pick('Bíceps braquial', 'Musculocutáneo');
    pick('Tríceps braquial', 'Radial');
    expect(check.hasAttribute('disabled')).toBe(true);
    pick('Pronador redondo', 'Mediano');
    fireEvent.click(check);
    expect(screen.getByText('4 de 4 pares correctos.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        {
          cardKind: 'matching',
          rating: Rating.Good,
          answer: { picks: ['Axilar', 'Musculocutáneo', 'Radial', 'Mediano'] },
        },
      ]);
    });
  });

  it('LD2: 2 de 4 (s = 0.5 < hardMinScore) es Again y dice lo que eligió', async () => {
    await only(nerves);
    renderStudy();
    await screen.findByText('Relaciona cada músculo con su inervación.');
    pick('Deltoides', 'Axilar');
    pick('Bíceps braquial', 'Musculocutáneo');
    pick('Tríceps braquial', 'Mediano');
    pick('Pronador redondo', 'Radial');
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    expect(screen.getByText('2 de 4 pares correctos.')).toBeTruthy();
    expect(screen.getByText('elegiste: Mediano')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([{ rating: Rating.Again }]);
    });
  });
});

describe('etiquetar una imagen (label_image, R10, LD §2)', () => {
  const rect = (x: number) => ({ x, y: 0.2, w: 0.15, h: 0.1 });
  const withImage = async () => {
    const assetId = newId();
    await createNote(
      {
        deck: { name: 'Mano' },
        content: {
          kind: 'label_image',
          imageAssetId: assetId,
          prompt: 'Nombra los huesos marcados.',
          alt: 'Mano derecha, vista palmar, con tres huesos del carpo marcados.',
          labels: [
            { n: 1, label: 'Escafoides', rects: [rect(0.1)] },
            { n: 2, label: 'Semilunar', rects: [rect(0.3)] },
            { n: 3, label: 'Piramidal', rects: [rect(0.5)] },
          ],
          explanation: '',
        },
        image: { assetId, data: new Uint8Array([1, 2]).buffer, mime: 'image/png', width: 800, height: 600 },
      },
      { now: T0 - 1 },
    );
  };

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:copia-local');
    URL.revokeObjectURL = vi.fn();
  });

  it('R1: tapadas y numeradas, sin sus nombres en el DOM; escribe cada una y se califica por aciertos', async () => {
    await withImage();
    const { container } = renderStudy();
    await screen.findByText('Nombra los huesos marcados.');
    expect(await screen.findByRole('img', { name: 'Etiqueta 1 de 3, tapada' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Escafoides|Semilunar|Piramidal/);
    fireEvent.change(screen.getByLabelText('Etiqueta 1'), { target: { value: ' escafoides ' } });
    fireEvent.change(screen.getByLabelText('Etiqueta 2'), { target: { value: 'Semilunar' } });
    fireEvent.change(screen.getByLabelText('Etiqueta 3'), { target: { value: 'Pisiforme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
    expect(screen.getByText('2 de 3 etiquetas bien escritas.')).toBeTruthy();
    expect(screen.getByText('Piramidal')).toBeTruthy(); // LD2: la ortografía correcta
    expect(screen.getByText('escribiste: Pisiforme')).toBeTruthy();
    // s = 2/3 < hardMinScore: Again.
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(async () => {
      expect(await logs()).toMatchObject([
        {
          cardKind: 'label_image',
          rating: Rating.Again,
          answer: { answers: ['escafoides', 'Semilunar', 'Pisiforme'] },
        },
      ]);
    });
  });
});
