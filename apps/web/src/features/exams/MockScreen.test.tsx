import { cardIdFor, Rating } from '@estudio/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { updateStudyConfig } from '@/features/settings';
import { answerCard } from '@/features/study';
import { createExam } from './commands';
import { ExamsScreen } from './ExamsScreen';
import { MockScreen } from './MockScreen';

const T0 = Date.UTC(2026, 9, 20, 15);
const DAY = 86_400_000;
const SESSION = '0192f1a0-0000-7000-8000-00000000a001';
const fronts = ['¿Qué nervio inerva el deltoides?', '¿Y el bíceps?', '¿Y el tríceps?'];
const backs = ['El axilar', 'El musculocutáneo', 'El radial'];

let examId = '';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams" element={<ExamsScreen />} />
        <Route path="/exams/:examId/mock" element={<MockScreen />} />
      </Routes>
    </MemoryRouter>,
  );

/** Responde la pregunta en pantalla con esa confianza y, opcionalmente, un texto. */
function answer(confidence: 'Poca' | 'Algo' | 'Mucha', text = '') {
  if (text) fireEvent.change(screen.getByLabelText('Tu respuesta (opcional)'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: confidence }));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
  const content = (i: number) =>
    ({
      kind: 'basic',
      front: fronts[i] ?? '',
      back: backs[i] ?? '',
      explanation: '',
      reverse: false,
    }) as const;
  const first = await createNote(
    { deck: { name: 'Brazo' }, content: content(0), topic: { name: 'Plexo braquial', explanation: '' } },
    { now: T0 - 10 * DAY },
  );
  const notes = [first];
  for (const i of [1, 2]) {
    notes.push(
      await createNote(
        { deck: { id: first.deckId }, content: content(i), topic: { id: first.topicId ?? '' } },
        { now: T0 - 10 * DAY },
      ),
    );
  }
  // Ya empezadas: el simulacro no examina lo que nunca vio.
  for (const note of notes) {
    await answerCard(
      {
        cardId: cardIdFor(note.id, 0),
        rating: Rating.Good,
        durationMs: 4_000,
        sessionId: SESSION,
        confidence: null,
      },
      { now: T0 - 9 * DAY },
    );
  }
  const exam = await createExam({ title: 'Parcial 1', date: T0 + 10 * DAY, topicIds: [first.topicId ?? ''] });
  examId = exam.id;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('simulacro (P7, LD13)', () => {
  it('R6, R1: confianza obligatoria y sin respuesta en pantalla hasta revisar; P7: cada calificación es un ReviewLog exam', async () => {
    const { container } = renderAt(`/exams/${examId}/mock`);
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar simulacro' }));
    expect(await screen.findByText('Pregunta 1 de 3')).toBeTruthy();
    // El simulacro baraja las preguntas: se anota cuál salió en cada paso.
    const shown = () => fronts.find((f) => screen.queryByText(f)) ?? '';
    const asked = [shown()];
    const next = screen.getByRole('button', { name: 'Siguiente' });
    expect(next.hasAttribute('disabled')).toBe(true); // R6: sin confianza no sigue
    for (const back of backs) expect(container.textContent).not.toContain(back); // R1

    vi.setSystemTime(T0 + 8_000);
    answer('Mucha', 'El axilar');
    fireEvent.click(next);
    await screen.findByText('Pregunta 2 de 3');
    asked.push(shown());
    answer('Algo');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Pregunta 3 de 3');
    asked.push(shown());
    answer('Mucha');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    // Al final se revisan todas: su respuesta, la correcta, y ella marca si acertó.
    expect(await screen.findByText('Revisión 1 de 3')).toBeTruthy();
    expect(new Set(asked).size).toBe(3);
    const marks: Record<string, boolean> = {
      [asked[0] ?? '']: true,
      [asked[1] ?? '']: true,
      [asked[2] ?? '']: false,
    };
    for (let i = 0; i < 3; i += 1) {
      await screen.findByText(`Revisión ${String(i + 1)} de 3`);
      const front = shown();
      fireEvent.click(screen.getByRole('button', { name: marks[front] ? 'Acerté' : 'No acerté' }));
    }

    const results = await screen.findByRole('region', { name: 'Resultado por tema' });
    expect(within(results).getByText('Acertaste 2 de 3 preguntas.')).toBeTruthy();
    expect(within(results).getByText('pocos datos')).toBeTruthy(); // 3 < topicMinItems
    const logs = (await db.reviewLogs.toArray()).filter((l) => l.type === 'exam');
    // Mucha + acierto = Good; Algo + acierto = Hard; fallo = Again (P7).
    expect(logs.map((l) => l.rating).sort()).toEqual([Rating.Again, Rating.Hard, Rating.Good].sort());
    expect(logs.find((l) => l.answer)).toMatchObject({
      answer: { text: 'El axilar' },
      reviewedAt: T0 + 8_000,
    });
    expect(new Set(logs.map((l) => l.sessionId)).size).toBe(1);
  });

  it('P7: con retroalimentación inmediata, la respuesta aparece tras elegir la confianza', async () => {
    await updateStudyConfig((c) => ({ ...c, exam: { ...c.exam, feedbackTiming: 'immediate' } }));
    renderAt(`/exams/${examId}/mock`);
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar simulacro' }));
    await screen.findByText('Pregunta 1 de 3');
    answer('Poca');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
    expect(await screen.findByRole('button', { name: 'Acerté' })).toBeTruthy();
    expect(screen.getByText('Lo que respondiste')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Acerté' }));
    expect(await screen.findByText('Pregunta 2 de 3')).toBeTruthy();
    const [log] = (await db.reviewLogs.toArray()).filter((l) => l.type === 'exam');
    expect(log).toMatchObject({ rating: Rating.Hard, confidence: 1 }); // acierto con poca confianza
  });

  it('§5: con preguntas suficientes en el tema, su resultado dice la tendencia de su confianza', async () => {
    await updateStudyConfig((c) => ({
      ...c,
      exam: { ...c.exam, feedbackTiming: 'immediate', topicMinItems: 3 },
    }));
    renderAt(`/exams/${examId}/mock`);
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar simulacro' }));
    // Mucha confianza en las tres y solo acierta una: confianza más alta que los aciertos.
    for (const [i, hit] of [true, false, false].entries()) {
      await screen.findByText(`Pregunta ${String(i + 1)} de 3`);
      answer('Mucha');
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar respuesta' }));
      fireEvent.click(await screen.findByRole('button', { name: hit ? 'Acerté' : 'No acerté' }));
    }
    const results = await screen.findByRole('region', { name: 'Resultado por tema' });
    expect(within(results).getByText('confianza más alta que los aciertos')).toBeTruthy();
    expect(within(results).queryByText('pocos datos')).toBeNull();
  });

  it('R3: el tiempo con la app en segundo plano no cuenta en la duración de la pregunta', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const goTo = (state: DocumentVisibilityState, at: number) => {
      vi.setSystemTime(at);
      visibility = state;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    renderAt(`/exams/${examId}/mock`);
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar simulacro' }));
    await screen.findByText('Pregunta 1 de 3'); // en pantalla desde T0
    goTo('hidden', T0 + 2_000);
    goTo('visible', T0 + 3_602_000); // una hora bloqueado
    vi.setSystemTime(T0 + 3_605_000);
    answer('Algo');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Pregunta 2 de 3');
    const [mock] = await db.studySessions.toArray();
    expect(mock?.items[0]?.durationMs).toBe(5_000);
  });

  it('se retoma donde quedó al volver', async () => {
    const first = renderAt(`/exams/${examId}/mock`);
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar simulacro' }));
    await screen.findByText('Pregunta 1 de 3');
    answer('Algo');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Pregunta 2 de 3');
    first.unmount();
    renderAt(`/exams/${examId}/mock`);
    expect(await screen.findByText('Pregunta 2 de 3')).toBeTruthy();
  });

  it('LD §2: los ejercicios, aunque estén empezados, todavía no entran al simulacro', async () => {
    const exercise = await createNote(
      {
        deck: { name: 'Pierna' },
        content: {
          kind: 'open_question',
          question: '¿Por qué cojea?',
          key: 'Glúteo medio.',
          explanation: '',
        },
        topic: { name: 'Cadera', explanation: '' },
      },
      { now: T0 - 10 * DAY },
    );
    await answerCard(
      {
        cardId: cardIdFor(exercise.id, 0),
        rating: Rating.Good,
        durationMs: 4_000,
        sessionId: SESSION,
        confidence: null,
      },
      { now: T0 - 9 * DAY },
    );
    const exam = await createExam({
      title: 'Parcial 3',
      date: T0 + 5 * DAY,
      topicIds: [exercise.topicId ?? ''],
    });
    renderAt(`/exams/${exam.id}/mock`);
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar simulacro' }));
    expect(await screen.findByText(/Todavía no hay tarjetas empezadas/)).toBeTruthy();
  });

  it('sin tarjetas empezadas de los temas lo explica', async () => {
    const other = await createNote({
      deck: { name: 'Pierna' },
      content: { kind: 'basic', front: '¿Fémur?', back: 'Hueso', explanation: '', reverse: false },
      topic: { name: 'Huesos', explanation: '' },
    });
    const exam = await createExam({
      title: 'Parcial 2',
      date: T0 + 5 * DAY,
      topicIds: [other.topicId ?? ''],
    });
    renderAt(`/exams/${exam.id}/mock`);
    fireEvent.click(await screen.findByRole('button', { name: 'Empezar simulacro' }));
    expect(await screen.findByText(/Todavía no hay tarjetas empezadas/)).toBeTruthy();
  });

  it('P7: con examen a menos de 8 semanas y sin simulacro esta semana, lo dice en Exámenes', async () => {
    renderAt('/exams');
    const card = await screen.findByRole('region', { name: 'Parcial 1' });
    expect(within(card).getByText('Esta semana corresponde un simulacro.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Hacer simulacro' })).toBeTruthy();
    await waitFor(() => {
      expect(card.textContent).not.toContain('Último simulacro');
    });
  });
});
