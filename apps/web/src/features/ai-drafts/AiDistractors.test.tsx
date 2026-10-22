import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createDeck } from '@/features/decks';
import { ApiError } from '@/lib/api';
import { AiDistractors, withDistractor } from './AiDistractors';

const api = vi.hoisted(() => ({ authorizedApi: vi.fn() }));
vi.mock('@/features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth')>()),
  authorizedApi: api.authorizedApi,
}));

let deckId: string;

/** Como en el editor: las opciones viven en el formulario y el panel las cambia. */
function Harness({ initial, correct }: { readonly initial: string[]; readonly correct: number | null }) {
  const [options, setOptions] = useState(initial);
  return (
    <>
      <output aria-label="opciones">{options.join(' | ')}</output>
      <AiDistractors
        deckId={deckId}
        question="¿Qué nervio inerva el deltoides?"
        options={options}
        correct={correct}
        onOptions={setOptions}
      />
    </>
  );
}

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  deckId = (await createDeck({ name: 'Hombro' })).id;
  api.authorizedApi.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LD14: distractores con IA en el editor', () => {
  it('pide la pregunta y la correcta antes de ofrecerlo; sin red, requiere conexión', () => {
    const { unmount } = render(<Harness initial={['Axilar', '', '']} correct={null} />);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Sugerir distractores con IA' }).disabled,
    ).toBe(true);
    expect(screen.getByText(/marca la opción correcta/)).toBeTruthy();
    unmount();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<Harness initial={['Axilar', '', '']} correct={0} />);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Sugerir distractores con IA' }).disabled,
    ).toBe(true);
    expect(screen.getByText('Requiere conexión.')).toBeTruthy();
  });

  it('manda la correcta y las otras que ya escribió; lo que usa pasa a la primera opción vacía', async () => {
    api.authorizedApi.mockResolvedValue({ distractors: ['Mediano', 'Musculocutáneo'] });
    render(<Harness initial={['Radial', 'Axilar', '']} correct={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir distractores con IA' }));
    expect(await screen.findByText(/Revisa que ninguno sea también correcto/)).toBeTruthy();
    expect(api.authorizedApi).toHaveBeenCalledWith('/ai/distractors', {
      method: 'POST',
      body: {
        question: '¿Qué nervio inerva el deltoides?',
        correct: 'Axilar',
        existing: ['Radial'],
        context: null,
      },
      schema: expect.anything() as unknown,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Usar «Mediano»' }));
    expect(screen.getByLabelText('opciones').textContent).toBe('Radial | Axilar | Mediano');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Agregado: «Mediano»' }).disabled).toBe(
      true,
    );
    await waitFor(async () => {
      expect((await db.aiDrafts.toArray()).map((d) => [d.kind, d.status])).toEqual([
        ['distractors', 'accepted'],
      ]);
    });
    // Sin opción vacía, se agrega otra (hasta 5).
    fireEvent.click(screen.getByRole('button', { name: 'Usar «Musculocutáneo»' }));
    expect(screen.getByLabelText('opciones').textContent).toBe('Radial | Axilar | Mediano | Musculocutáneo');
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(screen.getByRole('button', { name: 'Sugerir distractores con IA' })).toBeTruthy();
    expect(await db.notes.count()).toBe(0); // LD16: la nota se guarda cuando ella la guarda
  });

  it('descartar sin usar ninguno lo deja rejected', async () => {
    api.authorizedApi.mockResolvedValue({ distractors: ['Mediano'] });
    render(<Harness initial={['Axilar', '', '']} correct={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir distractores con IA' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar sugerencias' }));
    await waitFor(async () => {
      expect((await db.aiDrafts.toArray()).map((d) => d.status)).toEqual(['rejected']);
    });
    expect(screen.getByLabelText('opciones').textContent).toBe('Axilar |  | ');
  });

  it('LD17: con la cuota agotada lo dice; si falla, se puede reintentar', async () => {
    api.authorizedApi
      .mockRejectedValueOnce(new ApiError(429, 'ai_quota_exceeded'))
      .mockRejectedValueOnce(new ApiError(503, 'unavailable'))
      .mockResolvedValueOnce({ distractors: ['Mediano'] });
    render(<Harness initial={['Axilar', '', '']} correct={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir distractores con IA' }));
    expect(await screen.findByText('Ya usaste la IA de hoy. Disponible de nuevo a las 00:00.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir distractores con IA' }));
    expect(await screen.findByText('No se pudieron sugerir distractores.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Usar «Mediano»' })).toBeTruthy();
  });

  it('withDistractor: primera vacía que no es la correcta; si no hay, al final y hasta 5', () => {
    expect(withDistractor(['', 'Axilar', ''], 0, 'Mediano')).toEqual(['', 'Axilar', 'Mediano']);
    expect(withDistractor(['A', 'B', 'C'], 0, 'D')).toEqual(['A', 'B', 'C', 'D']);
    expect(withDistractor(['A', 'B', 'C', 'D', 'E'], 0, 'F')).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
