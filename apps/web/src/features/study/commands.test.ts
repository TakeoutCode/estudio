import { cardIdFor, defaultStudyConfig, Rating, ReviewLogSchema } from '@estudio/shared';
import { createScheduler, newCardState, replay } from '@estudio/srs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createNote, deleteNote } from '@/features/notes';
import { answerCard } from './commands';

const T0 = Date.UTC(2026, 9, 20, 15);
const SESSION = '0192f1a0-0000-7000-8000-00000000a001';
const content = { kind: 'basic', front: '¿C1?', back: 'Atlas', explanation: '', reverse: false } as const;

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
});

const answer = (cardId: string, rating: Rating, now: number) =>
  answerCard({ cardId, rating, durationMs: 5_000, sessionId: SESSION, confidence: null }, { now });

describe('answerCard (R3, SYNC SY6)', () => {
  it('R3: guarda el repaso completo, la proyección y el outbox juntos', async () => {
    const note = await createNote({ deck: { name: 'Columna' }, content }, { now: T0 });
    const cardId = cardIdFor(note.id, 0);
    await db.outbox.clear();

    const { log, state } = await answer(cardId, Rating.Good, T0 + 60_000);

    expect(ReviewLogSchema.parse(await db.reviewLogs.get(log.id))).toEqual(log);
    expect(log).toMatchObject({
      cardId,
      cardKind: 'basic',
      reviewedAt: T0 + 60_000,
      rating: Rating.Good,
      durationMs: 5_000,
      type: 'learn', // era nueva
      confidence: null,
      sessionId: SESSION,
    });
    expect(await db.cardStates.get(cardId)).toEqual(state);
    expect(state.reps).toBe(1);
    const outbox = await db.outbox.toArray();
    expect(outbox).toMatchObject([{ entity: 'reviewLog', op: 'append', row: log }]);
  });

  it('ARC5: los pasos de un solo repaso dan lo mismo que reproducir todo el log', async () => {
    const note = await createNote({ deck: { name: 'Columna' }, content }, { now: T0 });
    const cardId = cardIdFor(note.id, 0);
    await answer(cardId, Rating.Good, T0 + 60_000);
    await answer(cardId, Rating.Good, T0 + 11 * 60_000);
    const { state, log } = await answer(cardId, Rating.Hard, T0 + 3 * 86_400_000);
    expect(log.type).toBe('review');

    const cfg = defaultStudyConfig();
    const logs = await db.reviewLogs.toArray();
    expect(state).toEqual(replay(createScheduler(cfg.fsrs), newCardState(cardId, T0), logs, cfg.exam));
  });

  it('una tarjeta borrada no recibe repasos y no se escribe nada', async () => {
    const note = await createNote({ deck: { name: 'Columna' }, content }, { now: T0 });
    await deleteNote(note.id, { now: T0 + 1 });
    await db.outbox.clear();
    await expect(answer(cardIdFor(note.id, 0), Rating.Good, T0 + 2)).rejects.toThrow('card_not_found');
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
