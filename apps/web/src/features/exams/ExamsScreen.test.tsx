import { startOfLocalDate } from '@estudio/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { createExam, deleteExam, updateExam } from './commands';
import { ExamEditorScreen } from './ExamEditorScreen';
import { ExamsScreen } from './ExamsScreen';

const T0 = Date.UTC(2026, 9, 20, 15); // martes 20 de octubre, 09:00 en CDMX
const TZ = 'America/Mexico_City';
const DAY = 86_400_000;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams" element={<ExamsScreen />} />
        <Route path="/exams/new" element={<ExamEditorScreen />} />
        <Route path="/exams/:examId" element={<ExamEditorScreen />} />
      </Routes>
    </MemoryRouter>,
  );

/** `count` notas nuevas en un tema; devuelve el id del tema. */
async function topicWith(count: number, name = 'Plexo braquial'): Promise<string> {
  const content = (i: number) =>
    ({ kind: 'basic', front: `¿${name} ${String(i)}?`, back: 'R', explanation: '', reverse: false }) as const;
  const first = await createNote({
    deck: { name: 'Hombro' },
    content: content(0),
    topic: { name, explanation: '' },
  });
  const topicId = first.topicId ?? '';
  for (let i = 1; i < count; i += 1) {
    await createNote({ deck: { id: first.deckId }, content: content(i), topic: { id: topicId } });
  }
  return topicId;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('exámenes (R11, LD11)', () => {
  it('R11: se crea con título, fecha (inicio de su día local, AG6) y temas', async () => {
    const topicId = await topicWith(1);
    renderAt('/exams/new');
    fireEvent.change(await screen.findByLabelText('Nombre del examen'), { target: { value: 'Parcial 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Elige la fecha del examen.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Elige al menos un tema.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Plexo braquial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(async () => {
      expect(await db.exams.toArray()).toMatchObject([
        { title: 'Parcial 1', date: startOfLocalDate('2026-11-05', TZ), topicIds: [topicId] },
      ]);
    });
  });

  it('LD11: muestra los días para estudiar, las nuevas por tema y la sugerencia por día', async () => {
    const topicId = await topicWith(25);
    await createExam({ title: 'Parcial 1', date: startOfLocalDate('2026-10-30', TZ), topicIds: [topicId] });
    renderAt('/exams');
    const card = await screen.findByRole('region', { name: 'Parcial 1' });
    expect(within(card).getByText(/10 días para estudiar/)).toBeTruthy();
    expect(
      within(card).getByText('≈ 3 nuevas por día alcanzan para ver todo antes del examen.'),
    ).toBeTruthy();
    expect(within(card).getByText('25 nuevas')).toBeTruthy();
  });

  it('P1: si con el tope de nuevas por día no alcanza, lo dice sin alarma', async () => {
    const topicId = await topicWith(25);
    await createExam({ title: 'Parcial 1', date: startOfLocalDate('2026-10-22', TZ), topicIds: [topicId] });
    renderAt('/exams');
    const card = await screen.findByRole('region', { name: 'Parcial 1' });
    expect(within(card).getByText(/Con el tope de 10 nuevas por día, 5 tarjetas no alcanzan/)).toBeTruthy();
  });

  it('los exámenes pasados van aparte; sin próximos, invita a agregar uno', async () => {
    const topicId = await topicWith(1);
    await createExam({ title: 'Parcial 0', date: startOfLocalDate('2026-10-01', TZ), topicIds: [topicId] });
    renderAt('/exams');
    expect(await screen.findByText(/No tienes exámenes próximos/)).toBeTruthy();
    expect(screen.getByText('Exámenes pasados')).toBeTruthy();
  });

  it('editar y borrar son escrituras LWW con su outbox', async () => {
    const topicId = await topicWith(1);
    const exam = await createExam({ title: 'Parcial', date: T0 + 10 * DAY, topicIds: [topicId] });
    const edited = await updateExam(exam.id, { title: 'Parcial 1', date: exam.date, topicIds: [topicId] });
    expect(edited.title).toBe('Parcial 1');
    const deleted = await deleteExam(exam.id);
    expect(deleted.deletedAt).toBe(deleted.updatedAt);
    await expect(updateExam(exam.id, { title: 'X', date: 1, topicIds: [topicId] })).rejects.toThrow(
      'exam_not_found',
    );
    expect((await db.outbox.toArray()).filter((e) => e.entity === 'exam')).toHaveLength(3);
  });
});

describe('LD12 en Exámenes', () => {
  it('LD12: en la ventana final ofrece el repaso previo con su cantidad', async () => {
    const topicId = await topicWith(1);
    const [card] = await db.cards.toArray();
    await db.cardStates.put({
      cardId: card?.id ?? '',
      due: T0 + 30 * DAY,
      stability: 40,
      difficulty: 5,
      scheduledDays: 40,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      phase: 'review',
      lastReview: T0 - 20 * DAY,
    });
    const exam = await createExam({
      title: 'Parcial 1',
      date: startOfLocalDate('2026-10-24', TZ),
      topicIds: [topicId],
    });
    renderAt('/exams');
    const region = await screen.findByRole('region', { name: 'Parcial 1' });
    expect(
      await within(region).findByText('Repaso previo: 1 tarjeta que FSRS programó para después del examen.'),
    ).toBeTruthy();
    expect(within(region).getByRole('link', { name: 'Hacer el repaso previo' }).getAttribute('href')).toBe(
      `/study?examen=${exam.id}`,
    );
  });
});
