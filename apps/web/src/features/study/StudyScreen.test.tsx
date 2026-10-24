import { cardIdFor, defaultStudyConfig, encodeHlc, newId, Rating, type ReviewLog } from '@estudio/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceId } from '@/db/clock';
import { db } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { setDeckPaused } from '@/features/decks';
import { createExam } from '@/features/exams';
import { createNote, deleteNote, updateNote } from '@/features/notes';
import { updateProfile, updateStudyConfig } from '@/features/settings';
import { dispatchTimer } from '@/features/timer';
import { useSessionLock } from '@/lib/session-lock';
import { saveSelfExplanation } from './commands';
import { planSessionNow } from './queries';
import { useStudy } from './store';
import { StudyScreen } from './StudyScreen';

const T0 = Date.UTC(2026, 9, 20, 15);
const DAY = 86_400_000;

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
  vi.restoreAllMocks();
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

  it('R14 y R1: su mnemotecnia aparece solo después del intento, con la respuesta', async () => {
    const note = (await db.notes.toArray()).find(
      (n) => n.content.kind === 'basic' && n.content.front === humerus.front,
    );
    if (!note) throw new Error('sin nota');
    const mnemonic = 'Radial: rodea el húmero por detrás';
    await updateNote(note.id, { content: humerus, mnemonic }, { now: T0 });
    const { container } = renderStudy();
    expect(await screen.findByText(humerus.front)).toBeTruthy();
    expect(container.textContent).not.toContain(mnemonic);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    expect(screen.getByRole('heading', { name: 'Tu mnemotecnia' })).toBeTruthy();
    expect(screen.getByText(mnemonic)).toBeTruthy();
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

  it('§3: el resumen final da tarjetas, tiempo activo y retención del día, sin meta', async () => {
    // Un repaso de hoy en otra sesión, olvidado: cuenta en la retención del día, no en el tiempo.
    await db.reviewLogs.add({
      id: '0192f1a0-0000-7000-8222-000000000999',
      cardId: '0192f1a0-0000-7000-8333-000000000001',
      cardKind: 'basic',
      reviewedAt: T0 - 3_600_000,
      rating: Rating.Again,
      durationMs: 8_000,
      type: 'review',
      confidence: null,
      sessionId: '0192f1a0-0000-7000-8000-00000000a0ff',
      deviceId: '0192f1a0-0000-7000-8000-00000000d001',
    });
    renderStudy();
    await screen.findByText(humerus.front);
    vi.setSystemTime(T0 + 6_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fácil' }));
    await screen.findByText(femur.front);
    vi.setSystemTime(T0 + 66_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fácil' }));

    expect(await screen.findByText('Completaste esta sesión')).toBeTruthy();
    expect(screen.getByText('Respondiste 2 tarjetas.')).toBeTruthy();
    expect(await screen.findByText('Tiempo activo: 1 min.')).toBeTruthy();
    expect(
      screen.getByText(
        'En los repasos de hoy recordaste 0 de 1. Con tu objetivo de 90 %, olvidar algunas es lo esperado.',
      ),
    ).toBeTruthy();
  });

  it('UX9: el resumen final no muestra las métricas que ella ocultó', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await updateStudyConfig((cfg) => ({
      ...cfg,
      metrics: { ...cfg.metrics, visible: { ...cfg.metrics.visible, activeTime: false } },
    }));
    renderStudy();
    for (const card of [humerus, femur]) {
      await screen.findByText(card.front);
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
      fireEvent.click(screen.getByRole('button', { name: 'Fácil' }));
    }
    expect(await screen.findByText('Respondiste 2 tarjetas.')).toBeTruthy();
    expect(screen.queryByText(/Tiempo activo/)).toBeNull();
  });

  it('R3: con la app en segundo plano o el teléfono bloqueado, ese tiempo no cuenta', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const goTo = (state: DocumentVisibilityState, at: number) => {
      vi.setSystemTime(at);
      visibility = state;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    renderStudy();
    await screen.findByText(humerus.front); // en pantalla desde T0
    goTo('hidden', T0 + 3_000);
    goTo('visible', T0 + 3_603_000); // una hora bloqueado
    vi.setSystemTime(T0 + 3_605_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await screen.findByText(femur.front);
    expect((await db.reviewLogs.toArray())[0]?.durationMs).toBe(5_000);
  });

  it('R3: "Salir" deja la tarjeta donde quedó y el tiempo fuera no cuenta', async () => {
    render(
      <MemoryRouter initialEntries={['/study']}>
        <Routes>
          <Route path="/study" element={<StudyScreen />} />
          <Route path="/" element={<Link to="/study">Volver a estudiar</Link>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(humerus.front); // en pantalla desde T0
    vi.setSystemTime(T0 + 4_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('link', { name: 'Salir' }));
    vi.setSystemTime(T0 + 600_000);
    fireEvent.click(await screen.findByRole('link', { name: 'Volver a estudiar' }));

    expect(await screen.findByText(humerus.back)).toBeTruthy(); // ya la había revelado
    vi.setSystemTime(T0 + 602_000);
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await screen.findByText(femur.front);
    expect((await db.reviewLogs.toArray())[0]?.durationMs).toBe(6_000);
  });

  it('FE6: la sesión retiene la actualización de la PWA también tras "Salir", hasta terminarla', async () => {
    render(
      <MemoryRouter initialEntries={['/study']}>
        <Routes>
          <Route path="/study" element={<StudyScreen />} />
          <Route path="/" element={<p>Hoy</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(humerus.front);
    expect(useSessionLock.getState().holders).toBe(1);
    fireEvent.click(screen.getByRole('link', { name: 'Salir' }));
    await screen.findByText('Hoy');
    expect(useSessionLock.getState().holders).toBe(1); // la cola y la tarjeta a medias viven en memoria
    act(() => {
      useStudy.getState().end();
    });
    expect(useSessionLock.getState().holders).toBe(0);
  });

  it('R13: "Descansar" con una tarjeta en pantalla no la corta: el descanso empieza al terminarla', async () => {
    await dispatchTimer({ type: 'start' });
    renderStudy();
    await screen.findByText(humerus.front);
    fireEvent.click(await screen.findByRole('button', { name: 'Descansar' }));

    expect(await screen.findByText('El descanso empieza al terminar esta tarjeta.')).toBeTruthy();
    expect(screen.getByText(humerus.front)).toBeTruthy();
    expect((await db.timerSessions.toArray())[0]?.state).toBe('focus');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect((await db.timerSessions.toArray())[0]?.state).toBe('break_short');
    });
    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('R13: "Seguir sin descanso" cancela el descanso pedido', async () => {
    await dispatchTimer({ type: 'start' });
    renderStudy();
    await screen.findByText(humerus.front);
    fireEvent.click(await screen.findByRole('button', { name: 'Descansar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir sin descanso' }));
    expect(screen.queryByText('El descanso empieza al terminar esta tarjeta.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    expect(await screen.findByText(femur.front)).toBeTruthy();
    expect((await db.timerSessions.toArray())[0]?.state).toBe('focus');
  });

  it('UX3: si no se pudo armar la sesión, dice qué pasó y "Reintentar" la vuelve a armar', async () => {
    vi.spyOn(db.reviewLogs, 'toArray').mockRejectedValueOnce(new Error('lectura fallida'));
    renderStudy();
    expect(await screen.findByText(/Algo no salió bien/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText(humerus.front)).toBeTruthy();
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
    // Un descanso que empieza con la tarjeta a medias: en estructurado, pasada la gracia de R13.
    await act(async () => {
      await dispatchTimer({ type: 'takeBreak' }, { now: T0 + 10_000 });
    });
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
    useStudy.getState().start({
      id: SESSION,
      startedAt: T0,
      plan,
      askConfidence: false,
      ratingConfig: defaultStudyConfig(),
      scope: { kind: 'today' },
      scopeName: null,
    });
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

  it('P6: con su hora de dormir elegida en Ajustes, sugiere parar desde esa hora', async () => {
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await updateProfile((p) => ({ ...p, bedtime: '21:00' }), 'America/Mexico_City');
    vi.setSystemTime(Date.UTC(2026, 9, 21, 3, 30)); // 21:30 en CDMX: antes de las horas silenciosas
    renderStudy();
    expect(await screen.findByText(/Ya es tu hora de dormir/)).toBeTruthy();
    expect(screen.getByText(humerus.front)).toBeTruthy(); // nunca bloquea
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

  it('P5 y R13: con fatiga y un bloque en curso, "Tomar un descanso" lo abre al terminar la tarjeta y corta la serie', async () => {
    await focusBlock();
    await fatiguedSession();
    renderStudy();
    expect(await screen.findByText(/Tus últimas respuestas van más lentas/)).toBeTruthy();
    expect(screen.getByText(humerus.front)).toBeTruthy(); // nunca bloquea
    fireEvent.click(screen.getByRole('button', { name: 'Tomar un descanso' }));
    expect(await screen.findByText('El descanso empieza al terminar esta tarjeta.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    expect(await screen.findByRole('heading', { name: 'Descanso' })).toBeTruthy();
    await waitFor(() => {
      expect(useStudy.getState().fatigue).toMatchObject({ inRow: 0, showing: false });
    });
    // La respuesta recién dada puede contarse o no según llegue su lectura antes que el descanso.
    expect(useStudy.getState().fatigue.since).toBeGreaterThanOrEqual(20);
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

describe('StudyScreen · LD5 (entender antes de recordar)', () => {
  const deltoid = {
    kind: 'basic',
    front: '¿Qué nervio inerva el deltoides?',
    back: 'El axilar',
    explanation: '',
    reverse: false,
  } as const;
  const teres = { ...deltoid, front: '¿Y el redondo menor?' } as const;
  const plexus = { name: 'Plexo braquial', explanation: 'Raíces C5-T1 que forman troncos y nervios.' };

  it('R5: antes de la primera tarjeta nueva del tema, su explicación y la autoexplicación; no es un repaso', async () => {
    const note = await createNote(
      { deck: { name: 'Hombro' }, content: deltoid, topic: plexus },
      { now: T0 - 10 },
    );
    renderStudy();
    expect(await screen.findByRole('heading', { name: 'Plexo braquial' })).toBeTruthy();
    expect(screen.getByText(plexus.explanation)).toBeTruthy();
    expect(screen.queryByText(deltoid.front)).toBeNull(); // la tarjeta espera
    const save = screen.getByRole('button', { name: 'Guardar y seguir' });
    expect(save.hasAttribute('disabled')).toBe(true);

    vi.setSystemTime(T0 + 60_000);
    fireEvent.change(screen.getByLabelText('Explícalo con tus palabras'), {
      target: { value: 'Las raíces se juntan y salen nervios hacia el brazo.' },
    });
    fireEvent.click(save);
    expect(await screen.findByText(deltoid.front)).toBeTruthy();
    expect(await db.selfExplanations.toArray()).toMatchObject([
      {
        topicId: note.topicId,
        text: 'Las raíces se juntan y salen nervios hacia el brazo.',
        writtenAt: T0 + 60_000,
      },
    ]);
    expect(await db.reviewLogs.count()).toBe(0); // R15: no cuenta como repaso

    // R3: la duración de la tarjeta empieza al mostrarla, no al abrir el tema.
    vi.setSystemTime(T0 + 65_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect((await db.reviewLogs.toArray())[0]?.durationMs).toBe(5_000);
    });
  });

  it('LD5: "Ahora no" sigue con la tarjeta y no lo vuelve a pedir en esta sesión', async () => {
    await createNote({ deck: { name: 'Hombro' }, content: deltoid, topic: plexus }, { now: T0 - 10 });
    const [topic] = await db.topics.toArray();
    await createNote(
      { deck: { id: topic?.deckId ?? '' }, content: teres, topic: { id: topic?.id ?? '' } },
      { now: T0 - 9 },
    );
    renderStudy();
    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }));
    expect(await screen.findByText(deltoid.front)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    expect(await screen.findByText(teres.front)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Plexo braquial' })).toBeNull();
    expect(await db.selfExplanations.count()).toBe(0);
  });

  it('LD5: con una autoexplicación del tema ya guardada, va directo a la tarjeta', async () => {
    const note = await createNote(
      { deck: { name: 'Hombro' }, content: deltoid, topic: plexus },
      { now: T0 - 10 },
    );
    await saveSelfExplanation({ topicId: note.topicId ?? '', text: 'Ya lo escribí antes.' }, { now: T0 - 5 });
    renderStudy();
    expect(await screen.findByText(deltoid.front)).toBeTruthy();
    expect(screen.queryByLabelText('Explícalo con tus palabras')).toBeNull();
  });
});

describe('StudyScreen · un solo mazo (?mazo=)', () => {
  const atlas = {
    kind: 'basic',
    front: '¿Primera vértebra cervical?',
    back: 'El atlas',
    explanation: '',
    reverse: false,
  } as const;
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/study" element={<StudyScreen />} />
          <Route path="/decks" element={<p>Mazos</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('solo entra ese mazo, con su nombre de título; "Salir" vuelve a Mazos', async () => {
    const note = await createNote({ deck: { name: 'Columna' }, content: atlas }, { now: T0 - 3 });
    renderAt(`/study?mazo=${note.deckId}`);
    expect(await screen.findByText(atlas.front)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Columna' })).toBeTruthy();
    expect(useStudy.getState().session?.plan.queue.map((q) => q.cardId)).toEqual([cardIdFor(note.id, 0)]);

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    expect(await screen.findByText(/vuelve en \d+ min/)).toBeTruthy(); // ninguna de otro mazo
    fireEvent.click(screen.getByRole('link', { name: 'Salir' }));
    expect(await screen.findByText('Mazos')).toBeTruthy();
  });

  it('al volver a Hoy, la sesión mezcla otra vez todos los mazos', async () => {
    const note = await createNote({ deck: { name: 'Columna' }, content: atlas }, { now: T0 - 3 });
    const first = renderAt(`/study?mazo=${note.deckId}`);
    await screen.findByText(atlas.front);
    first.unmount();
    renderAt('/study');
    expect(await screen.findByRole('heading', { name: 'Repaso' })).toBeTruthy();
    await waitFor(() => {
      expect(useStudy.getState().session?.plan.queue).toHaveLength(3);
    });
  });

  it('un mazo en pausa no entra en Hoy, pero se puede estudiar a propósito', async () => {
    const note = await createNote({ deck: { name: 'Columna' }, content: atlas }, { now: T0 - 3 });
    await setDeckPaused(note.deckId, true);
    const today = renderAt('/study');
    expect(await screen.findByText(humerus.front)).toBeTruthy();
    expect(useStudy.getState().session?.plan.queue.map((q) => q.cardId)).not.toContain(cardIdFor(note.id, 0));
    today.unmount();
    renderAt(`/study?mazo=${note.deckId}`);
    expect(await screen.findByText(atlas.front)).toBeTruthy();
  });

  it('un mazo sin pendientes lo dice y ofrece añadir en él; uno borrado, que ya no existe', async () => {
    const note = await createNote({ deck: { name: 'Columna' }, content: atlas }, { now: T0 - 3 });
    await deleteNote(note.id);
    const empty = renderAt(`/study?mazo=${note.deckId}`);
    expect(await screen.findByText(/No hay tarjetas pendientes en este mazo/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nueva tarjeta' }).getAttribute('href')).toBe(
      `/notes/new?mazo=${note.deckId}`,
    );
    empty.unmount();
    renderAt('/study?mazo=0192f1a0-0000-7000-8000-0000000dead0');
    expect(await screen.findByText(/Este mazo ya no existe/)).toBeTruthy();
  });
});

describe('StudyScreen · R11 (examen próximo)', () => {
  it('R11: las nuevas del tema de un examen próximo entran antes que las demás', async () => {
    const before = await planSessionNow();
    expect(before.plan.queue[0]?.topicId).toBeNull(); // las de beforeEach, sin tema, son más antiguas
    const note = await createNote(
      {
        deck: { name: 'Cabeza' },
        content: {
          kind: 'basic',
          front: '¿Par craneal I?',
          back: 'El olfatorio',
          explanation: '',
          reverse: false,
        },
        topic: { name: 'Pares craneales', explanation: '' },
      },
      { now: T0 },
    );
    await createExam({ title: 'Parcial 1', date: T0 + 5 * DAY, topicIds: [note.topicId ?? ''] });
    const { plan } = await planSessionNow();
    expect(plan.queue[0]?.topicId).toBe(note.topicId);
  });
});

describe('StudyScreen · LD12 (repaso previo al examen)', () => {
  it('LD12: ?examen= arma la vuelta con lo que FSRS programó para después del examen; cuenta como repaso', async () => {
    const note = await createNote(
      {
        deck: { name: 'Hombro' },
        content: {
          kind: 'basic',
          front: '¿Nervio del deltoides?',
          back: 'El axilar',
          explanation: '',
          reverse: false,
        },
        topic: { name: 'Plexo braquial', explanation: '' },
      },
      { now: T0 - 60 * DAY },
    );
    const cardId = cardIdFor(note.id, 0);
    await db.cardStates.put({
      cardId,
      due: T0 + 20 * DAY, // después del examen
      stability: 40,
      difficulty: 5,
      scheduledDays: 40,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      phase: 'review',
      lastReview: T0 - 20 * DAY, // antes de la ventana
    });
    const exam = await createExam({ title: 'Parcial 1', date: T0 + 3 * DAY, topicIds: [note.topicId ?? ''] });
    // El alcance del examen lo eligió ella: entra aunque su mazo esté en pausa.
    await setDeckPaused(note.deckId, true);
    // R5 ya atendido para que vaya directo a la tarjeta.
    await saveSelfExplanation({ topicId: note.topicId ?? '', text: 'Ya lo expliqué.' }, { now: T0 - DAY });

    render(
      <MemoryRouter initialEntries={[`/study?examen=${exam.id}`]}>
        <StudyScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Repaso previo' })).toBeTruthy();
    expect(await screen.findByText('¿Nervio del deltoides?')).toBeTruthy();
    expect(screen.queryByText(humerus.front)).toBeNull(); // la cola es solo la del examen
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect(await db.reviewLogs.toArray()).toMatchObject([{ cardId, type: 'review' }]);
    });
  });

  it('LD12: fuera de la ventana no hay nada que repasar y lo dice', async () => {
    const note = await createNote({
      deck: { name: 'Hombro' },
      content: { kind: 'basic', front: '¿X?', back: 'Y', explanation: '', reverse: false },
      topic: { name: 'Plexo braquial', explanation: '' },
    });
    const exam = await createExam({
      title: 'Parcial 2',
      date: T0 + 30 * DAY,
      topicIds: [note.topicId ?? ''],
    });
    render(
      <MemoryRouter initialEntries={[`/study?examen=${exam.id}`]}>
        <StudyScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No hay tarjetas para el repaso previo/)).toBeTruthy();
  });
});

describe('StudyScreen · una etiqueta (?etiqueta=)', () => {
  const atlas = {
    kind: 'basic',
    front: '¿Primera vértebra cervical?',
    back: 'El atlas',
    explanation: '',
    reverse: false,
  } as const;
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/study" element={<StudyScreen />} />
          <Route path="/tags" element={<p>Etiquetas</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('solo sus tarjetas, de cualquier mazo y aunque esté en pausa; "Salir" vuelve a Etiquetas', async () => {
    const tagged = await createNote(
      { deck: { name: 'Columna' }, content: atlas, tags: [{ name: 'Parcial 2' }] },
      { now: T0 - 3 },
    );
    const [tagId] = tagged.tagIds;
    if (!tagId) throw new Error('faltó la etiqueta');
    await setDeckPaused(tagged.deckId, true);
    renderAt(`/study?etiqueta=${tagId}`);
    expect(await screen.findByText(atlas.front)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Parcial 2' })).toBeTruthy();
    expect(useStudy.getState().session?.plan.queue.map((q) => q.cardId)).toEqual([cardIdFor(tagged.id, 0)]);
    fireEvent.click(screen.getByRole('link', { name: 'Salir' }));
    expect(await screen.findByText('Etiquetas')).toBeTruthy();
  });

  it('una etiqueta borrada ya no existe', async () => {
    renderAt('/study?etiqueta=0192f1a0-0000-7000-8000-0000000dead1');
    expect(await screen.findByText(/Esta etiqueta ya no existe/)).toBeTruthy();
  });
});
