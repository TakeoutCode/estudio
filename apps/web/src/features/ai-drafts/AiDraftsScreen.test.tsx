import type { AiNoteDraft } from '@estudio/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createDeck } from '@/features/decks';
import { ApiError } from '@/lib/api';
import { AiDraftsScreen } from './AiDraftsScreen';

const api = vi.hoisted(() => ({ authorizedApi: vi.fn() }));
vi.mock('@/features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth')>()),
  authorizedApi: api.authorizedApi,
}));

const SOURCE = 'El deltoides está inervado por el nervio axilar, que sale del fascículo posterior.';
const draft = (overrides: Partial<AiNoteDraft> = {}): AiNoteDraft => ({
  kind: 'basic',
  front: '¿Qué nervio inerva el deltoides?',
  back: 'El axilar',
  explanation: 'Sale del fascículo posterior.',
  sourceQuote: 'El deltoides está inervado por el nervio axilar',
  options: null,
  ...overrides,
});

let deckId: string;
const renderScreen = () =>
  render(
    <MemoryRouter initialEntries={[`/decks/${deckId}/ia`]}>
      <Routes>
        <Route path="/decks/:deckId/ia" element={<AiDraftsScreen />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  deckId = (await createDeck({ name: 'Hombro' })).id;
  api.authorizedApi.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const paste = async (text: string) => {
  fireEvent.change(await screen.findByLabelText('Pega un fragmento de tus apuntes'), {
    target: { value: text },
  });
};

describe('Borradores con IA (LEARNING-DESIGN §8)', () => {
  it('LD17: avisa de la privacidad y, sin red, no deja generar', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderScreen();
    expect(await screen.findByText(/No pegues datos de pacientes/)).toBeTruthy();
    await paste(SOURCE);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generar borradores' }).disabled).toBe(true);
    expect(screen.getByText('Requiere conexión.')).toBeTruthy();
  });

  it('genera borradores para revisar; uno sin respaldo pide editarlo antes de aceptar', async () => {
    api.authorizedApi.mockResolvedValue({
      drafts: [draft(), draft({ front: '¿Qué abduce el brazo?', sourceQuote: 'Inventado' })],
      discarded: 1,
    });
    renderScreen();
    await paste(SOURCE);
    fireEvent.click(screen.getByRole('button', { name: 'Generar borradores' }));
    expect(await screen.findByText('Listo: 2 borradores para revisar.')).toBeTruthy();
    expect(screen.getByText('1 venía incompleto y se descartó.')).toBeTruthy();
    expect(api.authorizedApi).toHaveBeenCalledWith('/ai/drafts', expect.objectContaining({ method: 'POST' }));

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [good, unsupported] = items as [HTMLElement, HTMLElement];
    expect(within(unsupported).getByText('Sin respaldo en tu texto')).toBeTruthy();
    expect(within(unsupported).getByRole<HTMLButtonElement>('button', { name: 'Aceptar' }).disabled).toBe(
      true,
    );
    fireEvent.change(within(unsupported).getByLabelText('Respuesta'), { target: { value: 'El deltoides' } });
    expect(within(unsupported).getByRole<HTMLButtonElement>('button', { name: 'Aceptar' }).disabled).toBe(
      false,
    );

    fireEvent.click(within(good).getByRole('button', { name: 'Aceptar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray()).map((n) => [n.origin, n.deckId])).toEqual([['ai', deckId]]);
    });
    expect(await screen.findByText('Ya aceptaste 1 borrador en este mazo.')).toBeTruthy();
  });

  it('LD17: con la cuota agotada lo dice y su texto sigue ahí', async () => {
    api.authorizedApi.mockRejectedValue(new ApiError(429, 'ai_quota_exceeded'));
    renderScreen();
    await paste(SOURCE);
    fireEvent.click(screen.getByRole('button', { name: 'Generar borradores' }));
    expect(await screen.findByText('Ya usaste la IA de hoy. Disponible de nuevo a las 00:00.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Pega un fragmento de tus apuntes').value).toBe(SOURCE);
  });

  it('LD17: si falla, su texto sigue y puede reintentar', async () => {
    api.authorizedApi
      .mockRejectedValueOnce(new ApiError(503, 'unavailable'))
      .mockResolvedValueOnce({ drafts: [draft()], discarded: 0 });
    renderScreen();
    await paste(SOURCE);
    fireEvent.click(screen.getByRole('button', { name: 'Generar borradores' }));
    expect(await screen.findByText('No se pudo generar el borrador. Tu texto sigue aquí.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Listo: 1 borrador para revisar.')).toBeTruthy();
  });

  it('descartar lo saca de la lista sin crear nada', async () => {
    api.authorizedApi.mockResolvedValue({ drafts: [draft()], discarded: 0 });
    renderScreen();
    await paste(SOURCE);
    fireEvent.click(screen.getByRole('button', { name: 'Generar borradores' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    await waitFor(() => {
      expect(screen.queryByRole('listitem')).toBeNull();
    });
    expect(await db.notes.count()).toBe(0);
  });

  it('LD14: casos clínicos: los pide a su ruta, se editan y aceptarlos crea el caso', async () => {
    api.authorizedApi.mockResolvedValue({
      drafts: [
        {
          vignette: 'Paciente de 34 años con debilidad para abducir el brazo tras una luxación anterior.',
          questions: [
            {
              type: 'multiple_choice',
              question: '¿Qué nervio se lesionó?',
              answer: 'Axilar',
              options: ['Radial', 'Axilar', 'Mediano'],
            },
            {
              type: 'type_answer',
              question: '¿Qué músculo pierde fuerza?',
              answer: 'Deltoides',
              options: null,
            },
          ],
          explanation: 'El axilar inerva el deltoides.',
          sourceQuote: 'Inventado',
        },
      ],
      discarded: 0,
    });
    renderScreen();
    await paste(SOURCE);
    fireEvent.click(screen.getByRole('button', { name: 'Casos clínicos' }));
    expect(screen.getByRole('button', { name: 'Casos clínicos' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Generar borradores' }));
    expect(await screen.findByText('Listo: 1 borrador para revisar.')).toBeTruthy();
    expect(api.authorizedApi).toHaveBeenCalledWith(
      '/ai/clinical-cases',
      expect.objectContaining({ method: 'POST', body: { sourceText: SOURCE } }),
    );

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('Caso clínico')).toBeTruthy();
    expect(within(item).getByText('Sin respaldo en tu texto')).toBeTruthy();
    expect(
      within(item).getByRole<HTMLInputElement>('radio', { name: 'La opción 2 es la correcta' }).checked,
    ).toBe(true);
    // Quitar una subpregunta cuenta como edición: ya se puede aceptar.
    fireEvent.click(within(item).getByRole('button', { name: 'Quitar la pregunta 2' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Aceptar' }));
    await waitFor(async () => {
      expect((await db.notes.toArray()).map((n) => [n.origin, n.content.kind])).toEqual([
        ['ai', 'clinical_case'],
      ]);
    });
  });
});
