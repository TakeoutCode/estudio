import { cardIdFor, type Confidence, Rating, type ReviewLog } from '@estudio/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { setDeckPaused } from '@/features/decks';
import { createNote } from '@/features/notes';
import { updateStudyConfig } from '@/features/settings';
import { logSleep } from '@/features/sleep';
import { DashboardScreen } from './DashboardScreen';
import { loadMetricsInput } from './queries';

// jsdom no tiene Worker: el worker corre en el mismo hilo.
vi.mock('@/workers/projection', async () => {
  const api = (await import('@/workers/projection-api')).projectionApi;
  return {
    projectionWorker: () => ({
      weeklyMetrics: (...args: Parameters<typeof api.weeklyMetrics>) =>
        Promise.resolve(api.weeklyMetrics(...args)),
      replayCards: (...args: Parameters<typeof api.replayCards>) => Promise.resolve(api.replayCards(...args)),
    }),
  };
});

const T0 = Date.UTC(2026, 9, 20, 15); // martes 20, 09:00 en CDMX
const DAY = 86_400_000;
const SESSION = '0192f1a0-0000-7000-8000-00000000a001';

let seq = 0;
const logAt = (reviewedAt: number, rating: Rating, confidence: Confidence | null = null): ReviewLog => {
  seq += 1;
  return {
    id: `0192f1a0-0000-7000-8444-${String(seq).padStart(12, '0')}`,
    cardId: '0192f1a0-0000-7000-8333-000000000001',
    cardKind: 'basic',
    reviewedAt,
    rating,
    durationMs: 20_000,
    type: 'review',
    confidence,
    sessionId: SESSION,
    deviceId: '0192f1a0-0000-7000-8000-00000000d001',
  };
};

/** `count` repasos de hoy, uno cada 30 s, `recalled` de ellos con Good. */
const today = (count: number, recalled: number, confidence: Confidence | null = null) =>
  Array.from({ length: count }, (_, i) =>
    logAt(T0 - 2 * 3_600_000 + i * 30_000, i < recalled ? Rating.Good : Rating.Again, confidence),
  );

const renderDashboard = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <DashboardScreen />
    </MemoryRouter>,
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Tu semana (§5, UX9)', () => {
  it('UX9: con menos de `minReviewsToShow` repasos, "Pocos datos todavía" y ninguna cifra', async () => {
    await db.reviewLogs.bulkAdd(today(99, 90));
    renderDashboard();
    expect(await screen.findByText(/Pocos datos todavía/)).toBeTruthy();
    expect(screen.queryByText('Retención real')).toBeNull();
  });

  it('§5: tiempo activo, retención con rango frente al objetivo y pendientes por día', async () => {
    await db.reviewLogs.bulkAdd(today(120, 108));
    const content = { kind: 'basic', front: '¿C1?', back: 'Atlas', explanation: '', reverse: false } as const;
    const note = await createNote({ deck: { name: 'Columna' }, content }, { now: T0 - 10 * DAY });
    // Una aprendida que venció ayer: pendiente hoy (la proyección, sin repasos en esta semana).
    await db.cardStates.put({
      cardId: cardIdFor(note.id, 0),
      due: T0 - DAY,
      stability: 5,
      difficulty: 5,
      scheduledDays: 5,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      phase: 'review',
      lastReview: T0 - 6 * DAY,
    });
    renderDashboard();

    const time = await screen.findByRole('region', { name: 'Tiempo activo' });
    // 120 respuestas: la primera aporta 20 s y las otras 119, 30 s cada una.
    expect(within(time).getByText('1 h 0 min')).toBeTruthy();
    expect(within(time).getByText('Todavía no hay semanas anteriores para comparar.')).toBeTruthy();

    const retention = screen.getByRole('region', { name: 'Retención real' });
    expect(within(retention).getByText('90 % en 120 repasos')).toBeTruthy();
    expect(within(retention).getByText(/^Rango probable: \d+ % a \d+ % · objetivo 90 %$/)).toBeTruthy();
    expect(within(retention).getByText(/olvidar unas 10 de cada 100/)).toBeTruthy();

    const load = screen.getByRole('region', { name: 'Pendientes' });
    expect(within(load).getByText('Hoy')).toBeTruthy();
    expect(within(load).getAllByRole('definition')[0]?.textContent).toBe('1');
    expect(within(load).getAllByRole('definition')).toHaveLength(7);
  });

  it('UX9: una métrica apagada en Ajustes no aparece', async () => {
    await db.reviewLogs.bulkAdd(today(120, 108));
    await updateStudyConfig((c) => ({
      ...c,
      metrics: { ...c.metrics, visible: { ...c.metrics.visible, retention: false } },
    }));
    renderDashboard();
    expect(await screen.findByRole('region', { name: 'Tiempo activo' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Retención real' })).toBeNull();
  });

  it('§5, R6: sin confianza registrada invita a activarla; con ella, una frase neutra', async () => {
    await db.reviewLogs.bulkAdd(today(100, 100));
    const { unmount } = renderDashboard();
    expect(await screen.findByText(/Puedes activarlo en Ajustes/)).toBeTruthy();
    unmount();

    await db.reviewLogs.bulkAdd(today(20, 5, 3)); // mucha confianza, pocos aciertos
    renderDashboard();
    expect(await screen.findByText('Esta semana tu confianza fue más alta que tus aciertos.')).toBeTruthy();
  });
});

describe('Tu semana · simulacros (§5, P7)', () => {
  const meta = {
    hlc: '0001760000000000:0000:0192f1a0-0000-7000-8000-00000000d001',
    updatedAt: T0,
    deletedAt: null,
  };
  const [carpo, hombro] = ['0192f1a0-0000-7000-8555-000000000001', '0192f1a0-0000-7000-8555-000000000002'];
  const exam = '0192f1a0-0000-7000-8666-000000000001';
  let card = 0;
  /** `count` preguntas del tema, las primeras `right` acertadas. */
  const items = (topicId: string, count: number, right: number) =>
    Array.from({ length: count }, (_, i) => {
      card += 1;
      return {
        cardId: `0192f1a0-0000-7000-8777-${String(card).padStart(12, '0')}`,
        topicId,
        confidence: 2 as const,
        answer: null,
        durationMs: 10_000,
        answeredAt: T0,
        correct: i < right,
      };
    });
  const mock = (id: string, finishedAt: number, list: ReturnType<typeof items>) => ({
    id,
    mode: 'exam' as const,
    examId: exam,
    feedbackTiming: 'end' as const,
    items: list,
    startedAt: finishedAt - 600_000,
    finishedAt,
    ...meta,
  });

  beforeEach(async () => {
    await db.reviewLogs.bulkAdd(today(120, 108));
    await db.topics.bulkAdd([
      { id: carpo, deckId: exam, name: 'Huesos del carpo', explanation: '', ...meta },
      { id: hombro, deckId: exam, name: 'Manguito rotador', explanation: '', ...meta },
    ]);
    await db.exams.add({
      id: exam,
      title: 'Anatomía I',
      date: T0 + 20 * DAY,
      topicIds: [carpo, hombro],
      ...meta,
    });
  });

  it('sin simulacros terminados lo dice sin cifras', async () => {
    renderDashboard();
    const card = await screen.findByRole('region', { name: 'Simulacros' });
    expect(within(card).getByText(/Cuando termines un simulacro/)).toBeTruthy();
  });

  it('el último de cada examen, por tema, con la tendencia frente al anterior, su calibración y "pocos datos"', async () => {
    await db.studySessions.bulkAdd([
      mock('0192f1a0-0000-7000-8888-000000000001', T0 - 7 * DAY, items(carpo, 6, 3)),
      mock('0192f1a0-0000-7000-8888-000000000002', T0 - DAY, [...items(carpo, 6, 5), ...items(hombro, 2, 1)]),
    ]);
    renderDashboard();
    const card = await screen.findByRole('region', { name: 'Simulacros' });
    expect(within(card).getByText(/^Anatomía I · /)).toBeTruthy();
    expect(within(card).getByText('Acertaste 6 de 8 preguntas.')).toBeTruthy();
    const [first, second] = within(card).getAllByRole('listitem') as [HTMLElement, HTMLElement];
    // Confianza media (2) y 5 de 6: acertó más de lo que esperaba (§5, por tema).
    expect(first.textContent).toBe('Huesos del carpo5 de 6antes: 3 de 6 · acertaste más de lo que esperabas');
    expect(second.textContent).toBe('Manguito rotador1 de 2pocos datos');
  });

  it('UX9: se apaga en Ajustes como las demás', async () => {
    await updateStudyConfig((c) => ({
      ...c,
      metrics: { ...c.metrics, visible: { ...c.metrics.visible, mockExams: false } },
    }));
    renderDashboard();
    expect(await screen.findByRole('region', { name: 'Tiempo activo' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Simulacros' })).toBeNull();
  });
});

describe('Tu semana · mazos en pausa', () => {
  it('la carga deja fuera los mazos en pausa, como Hoy; el historial queda completo', async () => {
    const basic = (front: string) =>
      ({ kind: 'basic', front, back: 'R', explanation: '', reverse: false }) as const;
    const kept = await createNote({ deck: { name: 'Huesos' }, content: basic('¿Fémur?') }, { now: T0 - 1 });
    const paused = await createNote(
      { deck: { name: 'Nervios' }, content: basic('¿Par I?') },
      { now: T0 - 1 },
    );
    await setDeckPaused(paused.deckId, true);
    const input = await loadMetricsInput(db, T0);
    expect(input.cards.map((c) => c.state.cardId)).toEqual([cardIdFor(kept.id, 0)]);
  });
});

describe('Tu semana · sueño (§5)', () => {
  const showSleep = () =>
    updateStudyConfig((c) => ({
      ...c,
      metrics: { ...c.metrics, visible: { ...c.metrics.visible, sleep: true } },
    }));

  it('apagado por defecto: ni se lee ni se muestra', async () => {
    await db.reviewLogs.bulkAdd(today(120, 108));
    await logSleep(4, { now: T0 });
    expect((await loadMetricsInput(db, T0)).sleepLogs).toEqual([]);
    renderDashboard();
    await screen.findByText('Retención real');
    expect(screen.queryByText('Tu sueño')).toBeNull();
  });

  it('activado: mediana de la semana o "pocos datos", sin metas', async () => {
    await db.reviewLogs.bulkAdd(today(120, 108));
    await showSleep();
    await logSleep(4, { now: T0 - 2 * DAY });
    const { unmount } = renderDashboard();
    const card = (await screen.findByRole('heading', { name: 'Tu sueño' })).closest('section');
    if (!card) throw new Error('faltó la tarjeta de sueño');
    expect(within(card).getByText(/Pocos datos todavía/)).toBeTruthy();
    unmount();

    await logSleep(2, { now: T0 - DAY });
    await logSleep(5, { now: T0 });
    renderDashboard();
    expect(await screen.findByText('Calidad mediana: 4 de 5 en 3 noches')).toBeTruthy();
  });
});
