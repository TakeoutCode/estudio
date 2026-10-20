import { cardIdFor, type Confidence, Rating, type ReviewLog } from '@estudio/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { setDeckPaused } from '@/features/decks';
import { createNote } from '@/features/notes';
import { updateStudyConfig } from '@/features/settings';
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
