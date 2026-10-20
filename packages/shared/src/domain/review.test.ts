import { describe, expect, it } from 'vitest';
import { CONTRACT_HEADER, CONTRACT_VERSION } from '../contract.js';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { DeckSchema } from './deck.js';
import { Rating, ReviewLogSchema } from './review.js';

const validLog = () => ({
  id: newId(),
  cardId: newId(),
  cardKind: 'cloze',
  reviewedAt: 1_760_000_000_000,
  rating: Rating.Good,
  durationMs: 4_200,
  type: 'review',
  confidence: null,
  sessionId: newId(),
  deviceId: newId(),
});

describe('ReviewLog (R3)', () => {
  it('acepta un repaso completo', () => {
    expect(ReviewLogSchema.safeParse(validLog()).success).toBe(true);
  });

  it.each(['reviewedAt', 'rating', 'durationMs', 'type', 'confidence', 'sessionId', 'cardKind'])(
    'R3: exige %s',
    (field) => {
      const log = Object.fromEntries(Object.entries(validLog()).filter(([key]) => key !== field));
      expect(ReviewLogSchema.safeParse(log).success).toBe(false);
    },
  );

  it('R6: la confianza va de 1 a 3 y la calificación de 1 a 4', () => {
    expect(ReviewLogSchema.safeParse({ ...validLog(), confidence: 3 }).success).toBe(true);
    expect(ReviewLogSchema.safeParse({ ...validLog(), confidence: 4 }).success).toBe(false);
    expect(ReviewLogSchema.safeParse({ ...validLog(), rating: 0 }).success).toBe(false);
  });

  it('rechaza campos desconocidos', () => {
    expect(ReviewLogSchema.safeParse({ ...validLog(), xp: 10 }).success).toBe(false);
  });
});

describe('Deck', () => {
  const node = newId();
  const deck = {
    id: newId(),
    hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node }),
    updatedAt: 1_760_000_000_000,
    deletedAt: null,
    description: null,
  };

  it('recorta el nombre y exige que no quede vacío', () => {
    expect(DeckSchema.parse({ ...deck, name: '  Huesos del carpo ' }).name).toBe('Huesos del carpo');
    expect(DeckSchema.safeParse({ ...deck, name: '   ' }).success).toBe(false);
  });
});

describe('contrato', () => {
  it('la cabecera va en minúsculas y la versión es un entero positivo', () => {
    expect(CONTRACT_HEADER).toBe(CONTRACT_HEADER.toLowerCase());
    expect(Number.isInteger(CONTRACT_VERSION)).toBe(true);
    expect(CONTRACT_VERSION).toBeGreaterThan(0);
  });
});
