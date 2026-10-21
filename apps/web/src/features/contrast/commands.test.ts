import { cardIdFor, MutationSchema, newId, Rating, type ReviewLog } from '@estudio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import { createNote } from '@/features/notes';
import { createContrastGroup, deleteContrastGroup, updateContrastGroup } from './commands';

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
});

afterEach(() => {
  vi.useRealTimers();
});

describe('grupos de contraste (R9, LD10)', () => {
  it('el brazo se sortea balanceado al crear y no cambia al editar; borrar es lógico', async () => {
    const [a, b, c] = [
      await learnedDue('I', 'Olfatorio'),
      await learnedDue('II', 'Óptico'),
      await learnedDue('III', 'Oculomotor'),
    ];
    const first = await createContrastGroup({ name: 'Nervios', noteIds: [a.id, b.id] }, { seed: 4 });
    const second = await createContrastGroup({ name: 'Otros', noteIds: [b.id, c.id] }, { seed: 4 });
    expect([first.abArm, second.abArm]).toEqual(['contrast', 'control']); // el segundo va al que tiene menos
    expect(first.abSeed).toBe(4);

    const edited = await updateContrastGroup(first.id, {
      name: 'Nervios craneales',
      noteIds: [a.id, b.id, c.id],
    });
    expect(edited).toMatchObject({ abArm: 'contrast', abSeed: 4, noteIds: [a.id, b.id, c.id] });
    await deleteContrastGroup(second.id);
    expect((await db.contrastGroups.get(second.id))?.deletedAt).not.toBeNull();
    const entries = (await db.outbox.toArray()).filter((e) => e.entity === 'contrastGroup');
    expect(entries).toHaveLength(4);
    for (const entry of entries) expect(MutationSchema.safeParse(entry).success).toBe(true);
  });
});
