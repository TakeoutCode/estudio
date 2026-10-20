import { cardIdFor, Rating } from '@estudio/shared';
import { replayCards } from '@estudio/srs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { createNote } from '@/features/notes';
import { updateStudyConfig } from '@/features/settings';
import { answerCard } from '@/features/study';
import type { ReplayInput } from '@/workers/projection-api';
import { ensureProjection } from './projection';

const replays = vi.hoisted(() => ({ count: 0 }));

// jsdom no tiene Worker: el worker corre en el mismo hilo y cuenta sus pasadas.
vi.mock('@/workers/projection', async () => {
  const { projectionApi } = await import('@/workers/projection-api');
  return {
    projectionWorker: () => ({
      replayCards: (input: ReplayInput) => {
        replays.count += 1;
        return Promise.resolve(projectionApi.replayCards(input));
      },
    }),
  };
});

const T0 = Date.UTC(2026, 9, 1, 15);
const DAY = 86_400_000;
const content = { kind: 'basic', front: '¿C1?', back: 'Atlas', explanation: '', reverse: false } as const;

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: '0192f1a0-0000-7000-8000-00000000c0de' });
  const note = await createNote({ deck: { name: 'Columna' }, content }, { now: T0 });
  const cardId = cardIdFor(note.id, 0);
  for (const at of [T0 + DAY, T0 + DAY + 600_000, T0 + 4 * DAY]) {
    await answerCard(
      { cardId, rating: Rating.Good, durationMs: 4_000, sessionId: note.id, confidence: null },
      { now: at },
    );
  }
  await ensureProjection(); // la primera vez no hay clave guardada
  replays.count = 0;
});

describe('ensureProjection (FE4, SYNC SY4)', () => {
  it('R2: guardar otra retención reprograma las tarjetas en el worker', async () => {
    await updateStudyConfig((c) => ({ ...c, fsrs: { ...c.fsrs, requestRetention: 0.95 } }));
    await ensureProjection();
    await ensureProjection();

    const config = await readStudyConfig(db);
    const [card] = await db.cards.toArray();
    expect(await db.cardStates.toArray()).toEqual(
      replayCards(
        card ? [{ cardId: card.id, createdAt: card.createdAt }] : [],
        await db.reviewLogs.toArray(),
        config,
      ),
    );
    expect(replays.count).toBe(1);
  });

  it('pedidos mientras corre: una sola pasada más al terminar, y nada si no cambió', async () => {
    await updateStudyConfig((c) => ({ ...c, fsrs: { ...c.fsrs, requestRetention: 0.85 } }));
    const first = ensureProjection();
    const second = ensureProjection();
    expect(second).toBe(first);
    await first;
    await ensureProjection();
    expect(replays.count).toBe(1);
  });
});
