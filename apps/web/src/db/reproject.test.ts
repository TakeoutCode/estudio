import { cardIdFor, Rating } from '@estudio/shared';
import { replayCards, replaySettingsKey } from '@estudio/srs';
import { beforeEach, describe, expect, it } from 'vitest';
import { updateStudyConfig } from '@/features/settings';
import { createNote, deleteNote } from '@/features/notes';
import { answerCard } from '@/features/study';
import { projectionApi } from '@/workers/projection-api';
import { PROJECTION_SETTINGS_KEY, type ReplayAll, reprojectIfStale } from './reproject';
import { db } from './schema';
import { readStudyConfig } from './settings';

const T0 = Date.UTC(2026, 9, 1, 15);
const DAY = 86_400_000;
const SESSION = '0192f1a0-0000-7000-8000-00000000a001';
const content = (front: string) =>
  ({ kind: 'basic', front, back: 'R', explanation: '', reverse: false }) as const;

/** El worker, en el mismo hilo (jsdom no tiene Worker). */
const inThread: ReplayAll = (input) => Promise.resolve(projectionApi.replayCards(input));

const answer = (cardId: string, rating: Rating, now: number) =>
  answerCard({ cardId, rating, durationMs: 4_000, sessionId: SESSION, confidence: null }, { now });

async function studiedCards(): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, front] of ['C1', 'C2', 'C3'].entries()) {
    const note = await createNote({ deck: { name: 'Columna' }, content: content(front) }, { now: T0 + i });
    const cardId = cardIdFor(note.id, 0);
    ids.push(cardId);
    await answer(cardId, Rating.Good, T0 + DAY);
    await answer(cardId, Rating.Good, T0 + DAY + 600_000);
    await answer(cardId, Rating.Good, T0 + 4 * DAY);
  }
  return ids;
}

const setRetention = (requestRetention: number) =>
  updateStudyConfig((c) => ({ ...c, fsrs: { ...c.fsrs, requestRetention } }), { now: T0 + 5 * DAY });

async function expectedStates() {
  const config = await readStudyConfig(db);
  const cards = (await db.cards.toArray()).filter((c) => c.deletedAt === null);
  return replayCards(
    cards.map((c) => ({ cardId: c.id, createdAt: c.createdAt })),
    await db.reviewLogs.toArray(),
    config,
  );
}

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
});

describe('reprojectIfStale (ARC5, FE4)', () => {
  it('R2: con otra retención reconstruye todas las fechas y guarda con qué configuración', async () => {
    const ids = await studiedCards();
    await reprojectIfStale(db, inThread);
    const before = await db.cardStates.bulkGet(ids);

    await setRetention(0.95);
    expect(await reprojectIfStale(db, inThread)).toBe(true);

    expect(await db.cardStates.toArray()).toEqual(await expectedStates());
    const after = await db.cardStates.bulkGet(ids);
    after.forEach((state, i) => {
      expect(state?.due).toBeLessThan(before[i]?.due ?? 0); // más retención, intervalos más cortos
    });
    expect((await db.meta.get(PROJECTION_SETTINGS_KEY))?.value).toBe(
      replaySettingsKey(await readStudyConfig(db)),
    );
  });

  it('sin cambios que afecten a replay() no recalcula', async () => {
    await studiedCards();
    expect(await reprojectIfStale(db, inThread)).toBe(true); // primera vez: sin clave guardada
    expect(await reprojectIfStale(db, inThread)).toBe(false);
    await updateStudyConfig((c) => ({ ...c, timer: { ...c.timer, focusMin: 50 } }));
    expect(await reprojectIfStale(db, inThread)).toBe(false);
  });

  it('R3: una respuesta que llega mientras calcula el worker no se pierde', async () => {
    const [first] = await studiedCards();
    if (!first) throw new Error('sin tarjetas');
    await setRetention(0.85);
    const racing: ReplayAll = async (input) => {
      const states = await inThread(input);
      await answer(first, Rating.Again, T0 + 10 * DAY); // ella responde antes de que termine
      return states;
    };
    await reprojectIfStale(db, racing);

    const state = await db.cardStates.get(first);
    expect(state?.reps).toBe(4);
    expect(state?.lapses).toBe(1);
    expect(await db.cardStates.toArray()).toEqual(await expectedStates());
  });

  it('SYNC §6: una tarjeta borrada mientras calcula sale de la proyección', async () => {
    await studiedCards();
    const [note] = await db.notes.toArray();
    if (!note) throw new Error('sin notas');
    await setRetention(0.85);
    const racing: ReplayAll = async (input) => {
      const states = await inThread(input);
      await deleteNote(note.id, { now: T0 + 10 * DAY });
      return states;
    };
    await reprojectIfStale(db, racing);
    expect(await db.cardStates.get(cardIdFor(note.id, 0))).toBeUndefined();
    expect(await db.cardStates.count()).toBe(2);
  });

  it('si la configuración cambia mientras calcula, la siguiente revisión la ve vieja', async () => {
    await studiedCards();
    await setRetention(0.85);
    const racing: ReplayAll = async (input) => {
      const states = await inThread(input);
      await setRetention(0.92);
      return states;
    };
    expect(await reprojectIfStale(db, racing)).toBe(true);
    expect(await reprojectIfStale(db, inThread)).toBe(true);
    expect(await db.cardStates.toArray()).toEqual(await expectedStates());
  });
});
