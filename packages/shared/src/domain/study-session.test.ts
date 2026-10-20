import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { MockItemSchema, StudySessionSchema } from './study-session.js';

const meta = {
  id: newId(),
  hlc: encodeHlc({ wall: 1, counter: 0, node: '0192f1a0-0000-7000-8000-00000000d001' }),
  updatedAt: 1,
  deletedAt: null,
};
const item = (patch = {}) => ({
  cardId: newId(),
  topicId: null,
  confidence: null,
  answer: null,
  durationMs: null,
  answeredAt: null,
  correct: null,
  ...patch,
});

describe('StudySession de simulacro (P7, LD13)', () => {
  it('un simulacro guarda sus preguntas y empieza sin respuestas', () => {
    const session = StudySessionSchema.parse({
      ...meta,
      mode: 'exam',
      examId: newId(),
      feedbackTiming: 'end',
      items: [item()],
      startedAt: 1,
      finishedAt: null,
    });
    expect(session.items[0]?.confidence).toBeNull();
  });

  it('R6: la confianza es 1-3; sin preguntas no hay simulacro', () => {
    expect(MockItemSchema.safeParse(item({ confidence: 4 })).success).toBe(false);
    expect(MockItemSchema.safeParse(item({ confidence: 2, answer: 'El axilar' })).success).toBe(true);
    expect(
      StudySessionSchema.safeParse({
        ...meta,
        mode: 'exam',
        examId: newId(),
        feedbackTiming: 'end',
        items: [],
        startedAt: 1,
        finishedAt: null,
      }).success,
    ).toBe(false);
  });
});
