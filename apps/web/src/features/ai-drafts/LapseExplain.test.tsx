import { AiFeedbackSchema, newId } from '@estudio/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { ApiError } from '@/lib/api';
import { LapseExplain } from './LapseExplain';

const api = vi.hoisted(() => ({ authorizedApi: vi.fn() }));
vi.mock('@/features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth')>()),
  authorizedApi: api.authorizedApi,
}));

const CARD = newId();
const question = '¿Qué inerva el nervio axilar?';
const answerKey = 'El deltoides y el redondo menor.\nRodea el cuello quirúrgico del húmero.';
const check = {
  verdict: 'partial',
  missing: ['El redondo menor'],
  misconceptions: [],
  suggestion: 'Recuerda los dos músculos que rodean el cuello quirúrgico.',
};

const renderPanel = (onDone = vi.fn()) => {
  render(<LapseExplain cardId={CARD} question={question} answerKey={answerKey} onDone={onDone} />);
  return onDone;
};

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  api.authorizedApi.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('§1, LD14: explicarla con sus palabras tras un fallo', () => {
  it('la IA dice si es correcta y qué faltó; se guarda con su texto, sin tocar la calificación', async () => {
    api.authorizedApi.mockResolvedValue(check);
    const onDone = renderPanel();
    expect(screen.getByRole('heading', { name: 'Explícalo con tus palabras' })).toBeTruthy();
    const ask = screen.getByRole('button', { name: 'Revisar con IA' });
    expect(ask.hasAttribute('disabled')).toBe(true); // sin texto no hay nada que revisar
    fireEvent.change(screen.getByLabelText('Tu explicación'), {
      target: { value: 'Inerva el deltoides porque rodea el húmero.' },
    });
    fireEvent.click(ask);

    expect(await screen.findByText('Va bien, pero le falta algo.')).toBeTruthy();
    expect(screen.getByText('El redondo menor')).toBeTruthy();
    expect(screen.getByText(/no cambia tu calificación/)).toBeTruthy();
    const [path, init] = api.authorizedApi.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/ai/explanation-check');
    expect(init).toMatchObject({
      method: 'POST',
      body: { question, key: answerKey, explanation: 'Inerva el deltoides porque rodea el húmero.' },
    });
    await waitFor(async () => {
      const [row] = await db.aiFeedback.toArray();
      expect(AiFeedbackSchema.parse(row)).toMatchObject({
        cardId: CARD,
        feedback: { verdict: 'partial', explanation: 'Inerva el deltoides porque rodea el húmero.' },
      });
    });
    expect(await db.reviewLogs.count()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('es opcional: "Seguir" sin escribir no pide nada a la IA', () => {
    const onDone = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(api.authorizedApi).not.toHaveBeenCalled();
  });

  it('FE7: sin red, la revisión dice "Requiere conexión" y puede seguir igual', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderPanel();
    fireEvent.change(screen.getByLabelText('Tu explicación'), { target: { value: 'El deltoides.' } });
    expect(screen.getByRole('button', { name: 'Revisar con IA' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Requiere conexión.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seguir' }).hasAttribute('disabled')).toBe(false);
  });

  it('LD17: con la cuota agotada lo dice sin perder su texto', async () => {
    api.authorizedApi.mockRejectedValue(new ApiError(429, 'ai_quota_exceeded'));
    renderPanel();
    const field = screen.getByLabelText<HTMLTextAreaElement>('Tu explicación');
    fireEvent.change(field, { target: { value: 'El deltoides.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar con IA' }));
    expect(await screen.findByText(/Ya usaste la IA de hoy/)).toBeTruthy();
    expect(field.value).toBe('El deltoides.');
  });
});
