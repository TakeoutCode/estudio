import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import {
  SELF_EXPLANATION_MAX_LENGTH,
  SelfExplanationSchema,
  TOPIC_EXPLANATION_MAX_LENGTH,
  TopicSchema,
} from './topic.js';

const meta = {
  id: newId(),
  hlc: encodeHlc({ wall: 1, counter: 0, node: '0192f1a0-0000-7000-8000-00000000d001' }),
  updatedAt: 1,
  deletedAt: null,
};

describe('Topic y SelfExplanation (LD5, R5)', () => {
  it('un tema pertenece a un mazo; la explicación puede quedar vacía', () => {
    const topic = TopicSchema.parse({ ...meta, deckId: newId(), name: '  Plexo braquial ', explanation: '' });
    expect(topic.name).toBe('Plexo braquial');
    expect(TopicSchema.safeParse({ ...meta, deckId: newId(), name: ' ', explanation: '' }).success).toBe(
      false,
    );
    const long = 'a'.repeat(TOPIC_EXPLANATION_MAX_LENGTH + 1);
    expect(TopicSchema.safeParse({ ...meta, deckId: newId(), name: 'X', explanation: long }).success).toBe(
      false,
    );
  });

  it('LD5: la autoexplicación no puede estar vacía y tiene un máximo', () => {
    const base = { ...meta, topicId: newId(), writtenAt: 1 };
    expect(SelfExplanationSchema.safeParse({ ...base, text: '   ' }).success).toBe(false);
    expect(SelfExplanationSchema.safeParse({ ...base, text: 'Con mis palabras' }).success).toBe(true);
    expect(
      SelfExplanationSchema.safeParse({ ...base, text: 'a'.repeat(SELF_EXPLANATION_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('SYNC SY1: ambos viajan por sync con su esquema', () => {
    expect(SYNC_ROW_SCHEMAS.topic).toBe(TopicSchema);
    expect(SYNC_ROW_SCHEMAS.selfExplanation).toBe(SelfExplanationSchema);
  });
});
