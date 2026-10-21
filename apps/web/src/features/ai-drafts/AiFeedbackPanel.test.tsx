import { newId } from '@estudio/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { ApiError } from '@/lib/api';
import { AiFeedbackPanel } from './AiFeedbackPanel';

const api = vi.hoisted(() => ({ authorizedApi: vi.fn() }));
vi.mock('@/features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth')>()),
  authorizedApi: api.authorizedApi,
}));

const CARD = newId();
const props = {
  cardId: CARD,
  question: '¿Por qué una fractura del cuello quirúrgico puede debilitar la abducción?',
  answerKey: 'Puede lesionar el nervio axilar, que inerva el deltoides.',
  answer: 'Por el nervio axilar.',
};
const feedback = {
  covered: ['Nombra el nervio axilar'],
  missing: ['Falta que inerva el deltoides'],
  misconceptions: [],
  suggestion: 'Di qué músculo pierde inervación.',
};

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  api.authorizedApi.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LD14: retroalimentación de IA de una respuesta abierta', () => {
  it('manda pregunta, clave y respuesta; muestra lo que cubrió y lo que faltó, sin calificar', async () => {
    api.authorizedApi.mockResolvedValue(feedback);
    render(<AiFeedbackPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pedir retroalimentación con IA' }));
    expect(await screen.findByText('Nombra el nervio axilar')).toBeTruthy();
    expect(screen.getByText('Falta que inerva el deltoides')).toBeTruthy();
    expect(screen.queryByText('Revisa esto')).toBeNull(); // lista vacía, sin título
    expect(screen.getByText(/la calificación sigue siendo tuya/)).toBeTruthy();
    const [path, init] = api.authorizedApi.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/ai/feedback');
    expect(init).toMatchObject({
      method: 'POST',
      body: { question: props.question, key: props.answerKey, answer: props.answer },
    });
    // Se guarda para volver a verla (solo inserción); ningún repaso se escribe por esto.
    expect((await db.aiFeedback.toArray()).map((f) => [f.cardId, f.feedback])).toEqual([[CARD, feedback]]);
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('sin red no deja pedirla; con la cuota agotada o un fallo, lo dice y puede calificarse igual', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { unmount } = render(<AiFeedbackPanel {...props} />);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pedir retroalimentación con IA' }).disabled,
    ).toBe(true);
    expect(screen.getByText('Requiere conexión.')).toBeTruthy();
    unmount();
    online.mockReturnValue(true);

    api.authorizedApi.mockRejectedValueOnce(new ApiError(429, 'ai_quota_exceeded'));
    render(<AiFeedbackPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pedir retroalimentación con IA' }));
    expect(await screen.findByText('Ya usaste la IA de hoy. Disponible de nuevo a las 00:00.')).toBeTruthy();
    api.authorizedApi.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Pedir retroalimentación con IA' }));
    expect(await screen.findByText(/Puedes calificarte igual/)).toBeTruthy();
    expect(await db.aiFeedback.count()).toBe(0);
  });
});
