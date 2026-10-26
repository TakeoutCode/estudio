import { Rating, type ReviewLog, startOfLocalDate } from '@estudio/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { readProfile, readStudyConfig } from '@/db/settings';
import { setDeckPaused } from '@/features/decks';
import { createExam } from '@/features/exams';
import { createNote } from '@/features/notes';
import { TodayScreen } from './TodayScreen';

const content = {
  kind: 'basic',
  front: '¿Hueso más largo?',
  back: 'El fémur',
  explanation: '',
  reverse: false,
} as const;

const renderToday = () =>
  render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TodayScreen', () => {
  it('UX3: muestra el estado vacío con una salida, sin lenguaje de atraso', async () => {
    const { container } = renderToday();
    expect(screen.getByRole('heading', { name: 'Hoy' })).toBeTruthy();
    expect(await screen.findByText(/No hay tarjetas pendientes/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nueva tarjeta' }).getAttribute('href')).toBe('/notes/new');
    expect(container.textContent).not.toMatch(/atrasad|vencid/i);
  });

  it('con tarjetas nuevas ofrece empezar la sesión', async () => {
    await createNote({ deck: { name: 'Huesos' }, content });
    renderToday();
    expect(await screen.findByText('Y 1 nueva para aprender')).toBeTruthy();
    expect(screen.getByText('Hoy no hay repasos pendientes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Empezar' }).getAttribute('href')).toBe('/study');
  });

  it('P1 por día: con el tope del día cumplido no ofrece más nuevas y lo dice sin presión', async () => {
    await createNote({ deck: { name: 'Huesos' }, content });
    const now = Date.UTC(2026, 9, 20, 15);
    vi.useFakeTimers({ toFake: ['Date'] }); // QA1: reloj falso, nunca el real
    vi.setSystemTime(now);
    // Diez tarjetas que empezó hoy en otra sesión: el tope inicial (10) ya se cumplió.
    await db.reviewLogs.bulkAdd(
      Array.from({ length: 10 }, (_, i) => ({
        id: `0192f1a0-0000-7000-8222-${String(i + 1).padStart(12, '0')}`,
        cardId: `0192f1a0-0000-7000-8333-${String(i + 1).padStart(12, '0')}`,
        cardKind: 'basic' as const,
        reviewedAt: now - i,
        rating: Rating.Good,
        durationMs: 5_000,
        type: 'learn' as const,
        confidence: null,
        sessionId: '0192f1a0-0000-7000-8000-00000000a001',
        deviceId: '0192f1a0-0000-7000-8000-00000000d001',
      })),
    );
    renderToday();
    expect(await screen.findByText('Hoy ya empezaste 10 nuevas; las siguientes entran mañana.')).toBeTruthy();
    expect(screen.queryByText(/nueva para aprender/)).toBeNull();
  });

  it('un mazo en pausa no cuenta en Hoy y el enlace a mazos lo dice', async () => {
    await createNote({ deck: { name: 'Huesos' }, content });
    const paused = await createNote({ deck: { name: 'Nervios' }, content: { ...content, front: '¿Par I?' } });
    await setDeckPaused(paused.deckId, true);
    renderToday();
    expect(await screen.findByText('Y 1 nueva para aprender')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tus mazos · 1 en pausa' }).getAttribute('href')).toBe('/decks');
  });
});

describe('TodayScreen · LD12: repaso previo al examen', () => {
  it('LD12: en la ventana final ofrece el repaso previo, aunque los exámenes se carguen aparte (FE9)', async () => {
    const T0 = Date.UTC(2026, 9, 20, 15); // martes 20 de octubre, 09:00 en CDMX
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const note = await createNote({
      deck: { name: 'Hombro' },
      content,
      topic: { name: 'Plexo braquial', explanation: '' },
    });
    const [card] = await db.cards.toArray();
    await db.cardStates.put({
      cardId: card?.id ?? '',
      due: T0 + 30 * 86_400_000,
      stability: 40,
      difficulty: 5,
      scheduledDays: 40,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      phase: 'review',
      lastReview: T0 - 20 * 86_400_000,
    });
    const exam = await createExam({
      title: 'Parcial 1',
      date: startOfLocalDate('2026-10-24', 'America/Mexico_City'),
      topicIds: [note.topicId ?? ''],
    });
    renderToday();
    const offer = (await screen.findByText('Repaso previo para Parcial 1: 1 tarjeta.')).closest(
      '[role=status]',
    );
    if (!(offer instanceof HTMLElement)) throw new Error('sin aviso');
    expect(within(offer).getByRole('link', { name: 'Empezar' }).getAttribute('href')).toBe(
      `/study?examen=${exam.id}`,
    );
  });
});

describe('TodayScreen · P3: la retención baja persiste', () => {
  const T0 = Date.UTC(2026, 9, 20, 18); // 12:00 en CDMX
  const DAY = 86_400_000;
  /** 10 repasos al día durante 10 días, 7 recordados: 70 % frente al umbral de 80 %. */
  const lowRetention = (): ReviewLog[] =>
    Array.from({ length: 100 }, (_, i) => ({
      id: `0192f1a0-0000-7000-8222-${String(i + 1).padStart(12, '0')}`,
      cardId: '0192f1a0-0000-7000-8333-000000000001',
      cardKind: 'basic',
      reviewedAt: T0 - Math.floor(i / 10) * DAY - (i % 10) * 60_000,
      rating: i % 10 < 7 ? Rating.Good : Rating.Again,
      durationMs: 5_000,
      type: 'review',
      confidence: null,
      sessionId: '0192f1a0-0000-7000-8000-00000000a001',
      deviceId: '0192f1a0-0000-7000-8000-00000000d001',
    }));

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
    await db.reviewLogs.bulkAdd(lowRetention());
  });

  it('P3: propone la mitad de nuevas y revisar carga y sueño; aceptarla baja el tope', async () => {
    renderToday();
    expect(await screen.findByText(/lleva al menos 7 días por debajo de tu objetivo/)).toBeTruthy();
    expect(screen.getByText(/de 10 a 5/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver Tu semana' }).getAttribute('href')).toBe('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Bajar a 5 nuevas' }));

    await waitFor(() => {
      expect(screen.queryByText('Una propuesta para estos días')).toBeNull();
    });
    expect((await readStudyConfig(db)).planner.newPerSessionMax).toBe(5);
    expect((await readProfile(db)).fewerNewAnsweredAt).toBe(T0);
  });

  it('P3: "Ahora no" no cambia el tope y no vuelve a proponerse enseguida', async () => {
    renderToday();
    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }));
    await waitFor(() => {
      expect(screen.queryByText('Una propuesta para estos días')).toBeNull();
    });
    expect((await readStudyConfig(db)).planner.newPerSessionMax).toBe(10);
    expect((await readProfile(db)).fewerNewAnsweredAt).toBe(T0);
  });
});
