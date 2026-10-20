import { encodeHlc, newId, Rating, type ReviewLog } from '@estudio/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceId } from '@/db/clock';
import { db } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { createNote } from '@/features/notes';
import { updateStudyConfig } from '@/features/settings';
import { planSessionNow } from './queries';
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

  it('R3: el descanso no cuenta en la duración de la tarjeta que quedó en pantalla', async () => {
    await focusBlock();
    renderStudy();
    await screen.findByText(humerus.front); // en pantalla desde T0
    vi.setSystemTime(T0 + 10_000);
    fireEvent.click(await screen.findByRole('button', { name: 'Descansar' }));
    expect(await screen.findByRole('heading', { name: 'Descanso' })).toBeTruthy();

    vi.setSystemTime(T0 + 190_000); // 3 min de descanso
    fireEvent.click(screen.getByRole('button', { name: 'Seguir estudiando' }));
    expect(await screen.findByText(humerus.front)).toBeTruthy();
    vi.setSystemTime(T0 + 195_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await screen.findByText(femur.front);
    expect((await db.reviewLogs.toArray())[0]?.durationMs).toBe(15_000);
  });
});

/** Un bloque de enfoque flexible en curso, de este dispositivo, desde T0. */
async function focusBlock() {
  const device = await db.transaction('rw', db.meta, () => deviceId(db));
  await db.timerSessions.put({
    id: newId(),
    hlc: encodeHlc({ wall: T0, counter: 0, node: device }),
    updatedAt: T0,
    deletedAt: null,
    state: 'focus',
    mode: 'flexible',
    startedAt: T0,
    pausedAt: null,
    pausedMs: 0,
    blockIndex: 0,
    completedBlocks: 0,
    plannedMs: 25 * 60_000,
    extendedThisBlock: false,
    ownerDeviceId: device,
    lastSeenAt: T0,
    endedReason: null,
  });
}

describe('StudyScreen · P5 y P6 (sugerencias que nunca bloquean)', () => {
  const SESSION = '0192f1a0-0000-7000-8000-00000000a0a0';
  const NIGHT = Date.UTC(2026, 9, 21, 5); // 23:00 del martes 20 en CDMX: pasó el inicio de las horas silenciosas
  let seq = 0;
  const sessionLog = (at: number, rating: Rating, durationMs: number): ReviewLog => {
    seq += 1;
    return {
      id: `0192f1a0-0000-7000-8222-${String(seq).padStart(12, '0')}`,
      cardId: '0192f1a0-0000-7000-8333-000000000001',
      cardKind: 'basic',
      reviewedAt: at,
      rating,
      durationMs,
      type: 'review',
      confidence: null,
      sessionId: SESSION,
      deviceId: '0192f1a0-0000-7000-8000-00000000d001',
    };
  };
  /** 10 respuestas bien y rápidas, luego `count` más lentas y con la mitad de "Otra vez". */
  const tired = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      sessionLog(from + i * 10_000, i % 2 === 0 ? Rating.Good : Rating.Again, 9_000),
    );

  /** Sesión ya empezada con 20 respuestas que muestran fatiga (P5). */
  async function fatiguedSession() {
    const { plan } = await planSessionNow();
    useStudy.getState().start({ id: SESSION, startedAt: T0, plan, askConfidence: false });
    const fresh = Array.from({ length: 10 }, (_, i) => sessionLog(T0 + i * 10_000, Rating.Good, 5_000));
    await db.reviewLogs.bulkAdd([...fresh, ...tired(T0 + 200_000, 10)]);
  }

  it('P6: pasada su hora de dormir sugiere parar; la tarjeta sigue y responder es seguir', async () => {
    vi.setSystemTime(NIGHT);
    renderStudy();
    expect(await screen.findByText(/Ya es tu hora de dormir/)).toBeTruthy();
    expect(screen.getByText(humerus.front)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await screen.findByText(femur.front);
    expect(screen.queryByText(/Ya es tu hora de dormir/)).toBeNull();
  });

  it('P6: "Terminar por ahora" cierra la sesión y vuelve a Hoy', async () => {
    vi.setSystemTime(NIGHT);
    render(
      <MemoryRouter initialEntries={['/study']}>
        <Routes>
          <Route path="/study" element={<StudyScreen />} />
          <Route path="/" element={<p>Hoy</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/Ya es tu hora de dormir/);
    fireEvent.click(screen.getByRole('button', { name: 'Terminar por ahora' }));
    expect(await screen.findByText('Hoy')).toBeTruthy();
    expect(useStudy.getState().session).toBeNull();
    expect(await db.reviewLogs.count()).toBe(0); // no responde nada por ella
  });

  it('P5: con fatiga y un bloque en curso, "Tomar un descanso" abre el descanso y corta la serie', async () => {
    await focusBlock();
    await fatiguedSession();
    renderStudy();
    expect(await screen.findByText(/Tus últimas respuestas van más lentas/)).toBeTruthy();
    expect(screen.getByText(humerus.front)).toBeTruthy(); // nunca bloquea
    fireEvent.click(screen.getByRole('button', { name: 'Tomar un descanso' }));
    expect(await screen.findByRole('heading', { name: 'Descanso' })).toBeTruthy();
    await waitFor(() => {
      expect(useStudy.getState().fatigue).toEqual({ inRow: 0, since: 20, showing: false });
    });
  });

  it('P5: sin temporizador solo informa; P6: el segundo aviso seguido sugiere parar', async () => {
    await fatiguedSession();
    renderStudy();
    expect(await screen.findByText(/Tus últimas respuestas van más lentas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tomar un descanso' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(screen.queryByText(/Tus últimas respuestas/)).toBeNull();

    // Otra ventana de `fatigueWindowCards` respuestas con fatiga, sin descanso entre medio.
    await db.reviewLogs.bulkAdd(tired(T0 + 400_000, 10));
    expect(await screen.findByText(/Van 2 avisos de cansancio seguidos/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mostrar respuesta' })).toBeTruthy();
  });
});
