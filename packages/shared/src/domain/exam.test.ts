import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { ExamSchema } from './exam.js';

const meta = {
  id: newId(),
  hlc: encodeHlc({ wall: 1, counter: 0, node: '0192f1a0-0000-7000-8000-00000000d001' }),
  updatedAt: 1,
  deletedAt: null,
};

describe('Exam (R11, LD11)', () => {
  it('R11: título, fecha y al menos un tema', () => {
    const topic = newId();
    expect(ExamSchema.parse({ ...meta, title: ' Parcial 1 ', date: 5, topicIds: [topic] }).title).toBe(
      'Parcial 1',
    );
    expect(ExamSchema.safeParse({ ...meta, title: 'Parcial', date: 5, topicIds: [] }).success).toBe(false);
    expect(ExamSchema.safeParse({ ...meta, title: ' ', date: 5, topicIds: [topic] }).success).toBe(false);
  });

  it('un tema no se repite en el alcance', () => {
    const topic = newId();
    expect(
      ExamSchema.safeParse({ ...meta, title: 'Parcial', date: 5, topicIds: [topic, topic] }).success,
    ).toBe(false);
  });
});
