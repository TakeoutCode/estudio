import { cardIdFor, newId, Rating, type ReviewLog } from '@estudio/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { createContrastGroup } from '@/features/contrast';
import { useStudy } from './store';
import { StudyScreen } from './StudyScreen';

const T0 = Date.UTC(2026, 9, 20, 15);
const DAY = 86_400_000;

const nerve = (front: string, back: string) =>
  ({ kind: 'basic', front, back, explanation: '', reverse: false }) as const;

/** Una nota aprendida (primer acierto hace 20 días) que vence hoy. */
async function learnedDue(front: string, back: string, topic?: string) {
  const note = await createNote(
    {
      deck: { name: 'Cabeza' },
      content: nerve(front, back),
      topic: topic ? { name: topic, explanation: '' } : null,
    },
    { now: T0 - 30 * DAY },
  );
  const cardId = cardIdFor(note.id, 0);
  const learn: ReviewLog = {
    id: newId(),
    cardId,
    cardKind: 'basic',
    reviewedAt: T0 - 20 * DAY,
    rating: Rating.Good,
    durationMs: 5000,
    type: 'learn',
    confidence: null,
    sessionId: newId(),
    deviceId: newId(),
  };
  await db.reviewLogs.add(learn);
  await db.cardStates.put({
    cardId,
    due: T0 - 60_000,
    stability: 10,
    difficulty: 5,
    scheduledDays: 10,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    phase: 'review',
    lastReview: T0 - 10 * DAY,
  });
  return note;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  useStudy.getState().end();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sets de contraste en la sesión (R9, P4, LD10)', () => {
  it('en la sesión, los repasos del grupo van seguidos con su aviso y se guardan como contrast', async () => {
    const a = await learnedDue('¿Qué nervio inerva el recto lateral?', 'El abducens (VI)', 'Pares craneales');
    const b = await learnedDue(
      '¿Qué nervio inerva el oblicuo superior?',
      'El troclear (IV)',
      'Pares craneales',
    );
    await createContrastGroup({ name: 'Motores del ojo', noteIds: [a.id, b.id] }, { seed: 0 });

    render(
      <MemoryRouter initialEntries={['/study']}>
        <StudyScreen />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Set de contraste · Motores del ojo \(1 de 2\)/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    expect(await screen.findByText(/Set de contraste · Motores del ojo \(2 de 2\)/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      const contrast = (await db.reviewLogs.toArray()).filter((l) => l.type === 'contrast');
      expect(contrast.map((l) => l.cardId).sort()).toEqual([cardIdFor(a.id, 0), cardIdFor(b.id, 0)].sort());
    });
  });

  it('un grupo del brazo de control se repasa sin aviso de set y como repaso normal', async () => {
    const a = await learnedDue('¿Nervio del recto lateral?', 'Abducens');
    const b = await learnedDue('¿Nervio del oblicuo superior?', 'Troclear');
    const group = await createContrastGroup({ name: 'Motores del ojo', noteIds: [a.id, b.id] }, { seed: 1 });
    expect(group.abArm).toBe('control');

    render(
      <MemoryRouter initialEntries={['/study']}>
        <StudyScreen />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Mostrar respuesta' });
    expect(screen.queryByText(/Set de contraste/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bien' }));
    await waitFor(async () => {
      expect((await db.reviewLogs.toArray()).filter((l) => l.type === 'review')).toHaveLength(1);
    });
  });
});
