import { encodeHlc, newId, Rating } from '@estudio/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceId } from '@/db/clock';
import { db } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { createNote } from '@/features/notes';
import { updateStudyConfig } from '@/features/settings';
import { useStudy } from './store';
import { StudyScreen } from './StudyScreen';

const T0 = Date.UTC(2026, 9, 20, 15);

const humerus = {
  kind: 'basic',
  front: '¿Qué nervio pasa por el surco radial?',
  back: 'El nervio radial',
  explanation: 'Por eso una fractura de la diáfisis del húmero puede lesionarlo.',
  reverse: false,
} as const;
const femur = {
  kind: 'basic',
  front: '¿Hueso más largo?',
  back: 'El fémur',
  explanation: '',
  reverse: false,
} as const;

const renderStudy = () =>
  render(
    <MemoryRouter initialEntries={['/study']}>
      <StudyScreen />
    </MemoryRouter>,
  );

beforeEach(async () => {
  // QA1: reloj falso solo para Date; IndexedDB y Testing Library siguen con sus timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  useStudy.getState().end();
  const deck = { name: 'Miembro superior' };
  await createNote({ deck, content: humerus }, { now: T0 - 2 });
  await createNote({ deck, content: femur }, { now: T0 - 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StudyScreen (LEARNING-DESIGN §4)', () => {
  it('R1 y FE10: la respuesta no está en el DOM antes del intento; R4: luego aparece con su explicación', async () => {
    const { container } = renderStudy();
    expect(await screen.findByText(humerus.front)).toBeTruthy();
    expect(container.textContent).not.toContain(humerus.back);
    expect(container.textContent).not.toContain(humerus.explanation);
    expect(screen.queryByRole('group', { name: /cómo te fue/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    expect(screen.getByText(humerus.back)).toBeTruthy();
    expect(screen.getByText(humerus.explanation)).toBeTruthy();
    expect(screen.getByRole('group', { name: /cómo te fue/i })).toBeTruthy();
  });

  it('R3: calificar guarda el repaso con su duración y pasa a la siguiente tarjeta', async () => {
    renderStudy();
    await screen.findByText(humerus.front);
    vi.setSystemTime(T0 + 4_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    vi.setSystemTime(T0 + 6_500);
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));

    expect(await screen.findByText(femur.front)).toBeTruthy();
    const [log] = await db.reviewLogs.toArray();
    expect(log).toMatchObject({ rating: Rating.Good, durationMs: 6_500, type: 'learn', confidence: null });
    expect(log?.sessionId).toBe(useStudy.getState().session?.id);
  });

  it('FE12: Espacio revela y los números califican; ningún atajo salta el intento', async () => {
    renderStudy();
    await screen.findByText(humerus.front);
    fireEvent.keyDown(window, { key: '3' }); // sin intento, calificar no hace nada
    expect(screen.queryByText(humerus.back)).toBeNull();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText(humerus.back)).toBeTruthy();
    fireEvent.keyDown(window, { key: '1' });
    await screen.findByText(femur.front);
    expect((await db.reviewLogs.toArray()).map((l) => l.rating)).toEqual([Rating.Again]);
  });

  it('UX1 y R19: "Otra vez" no usa rojo ni el color de peligro', async () => {
    renderStudy();
    await screen.findByText(humerus.front);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    expect(screen.getByRole('button', { name: 'Otra vez' }).className).not.toMatch(/danger|red/);
  });

  it('las que entran en aprendizaje vuelven más tarde; al terminar, un resumen neutro', async () => {
    renderStudy();
    for (const front of [humerus.front, femur.front]) {
      await screen.findByText(front);
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
      fireEvent.click(screen.getByRole('button', { name: front === humerus.front ? 'Bien' : 'Fácil' }));
    }
    // La primera quedó en un paso de aprendizaje de minutos: se espera o se termina.
    expect(await screen.findByText(/vuelve en \d+ min/)).toBeTruthy();
    await waitFor(() => {
      expect(useStudy.getState().answered).toBe(2);
    });
  });

  it('R6: con askConfidence, elegir la confianza es lo que revela y queda en el repaso', async () => {
    renderStudy();
    await screen.findByText(humerus.front);
    useStudy.setState((s) => ({ session: s.session ? { ...s.session, askConfidence: true } : null }));
    fireEvent.click(await screen.findByRole('button', { name: 'Algo' }));
    expect(screen.getByText(humerus.back)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await screen.findByText(femur.front);
    expect((await db.reviewLogs.toArray())[0]?.confidence).toBe(2);
  });
});

describe('StudyScreen · temporizador (§3)', () => {
  it('R7, R8: se elige el modo y el ritmo y el bloque empieza sin dejar la tarjeta', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    renderStudy();
    await screen.findByText(humerus.front);
    fireEvent.click(screen.getByRole('button', { name: 'Temporizador' }));
    expect(
      screen.getByText('25/5 es el ritmo más estudiado con estudiantes; puedes cambiarlo.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Estructurado/ }));
    fireEvent.click(screen.getByRole('button', { name: '50/10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Empezar bloque de 50 min' }));
    expect(await screen.findByText('Enfoque')).toBeTruthy();
    expect(screen.getByText('50:00')).toBeTruthy();
    expect(screen.getByText(humerus.front)).toBeTruthy();
  });

  it('R7: ritmo personalizado fuera de los presets, dentro de sus rangos', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    renderStudy();
    await screen.findByText(humerus.front);
    fireEvent.click(screen.getByRole('button', { name: 'Temporizador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Otro' }));
    expect(screen.getByRole('button', { name: 'Otro' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByLabelText('Enfoque (min)'), { target: { value: '121' } });
    expect(screen.getByText('Escribe un número de 5 a 120.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Empezar bloque' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Enfoque (min)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Descanso (min)'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Empezar bloque de 40 min' }));
    expect(await screen.findByText('40:00')).toBeTruthy();
    const config = await readStudyConfig(db);
    expect(config.timer).toMatchObject({ focusMin: 40, shortBreakMin: 8 });
  });

  it('R7: un ritmo guardado que no es preset abre en "Otro"', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await updateStudyConfig((c) => ({ ...c, timer: { ...c.timer, focusMin: 40, shortBreakMin: 8 } }));
    renderStudy();
    await screen.findByText(humerus.front);
    fireEvent.click(screen.getByRole('button', { name: 'Temporizador' }));
    expect(screen.getByRole('button', { name: 'Otro' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>('Enfoque (min)').value).toBe('40');
    fireEvent.click(screen.getByRole('button', { name: '25/5' }));
    expect(screen.queryByLabelText('Enfoque (min)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Empezar bloque de 25 min' })).toBeTruthy();
  });

  it('R13: el descanso reemplaza la tarjeta hasta "Seguir estudiando"', async () => {
    const device = await db.transaction('rw', db.meta, () => deviceId(db));
    await db.timerSessions.put({
      id: newId(),
      hlc: encodeHlc({ wall: T0, counter: 0, node: device }),
      updatedAt: T0,
      deletedAt: null,
      state: 'break_short',
      mode: 'structured',
      startedAt: T0 - 60_000,
      pausedAt: null,
      pausedMs: 0,
      blockIndex: 1,
      completedBlocks: 1,
      plannedMs: 5 * 60_000,
      extendedThisBlock: false,
      ownerDeviceId: device,
      lastSeenAt: T0,
      endedReason: null,
    });
    renderStudy();
    expect(await screen.findByRole('heading', { name: 'Descanso' })).toBeTruthy();
    expect(screen.getByText('4:00')).toBeTruthy();
    expect(screen.queryByText(humerus.front)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir estudiando' }));
    expect(await screen.findByText(humerus.front)).toBeTruthy();
    expect(await db.timerBlockLogs.count()).toBe(1); // el descanso omitido queda registrado (§5)
  });
});
