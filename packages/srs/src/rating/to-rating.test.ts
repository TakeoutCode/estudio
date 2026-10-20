import { defaultStudyConfig, Rating } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { fractionScore, sequenceScore, toRating } from './to-rating.js';

const cfg = defaultStudyConfig();

describe('toRating (LEARNING-DESIGN LD2)', () => {
  it('autoevaluadas: devuelve lo que ella eligió', () => {
    expect(toRating({ kind: 'self', rating: Rating.Hard }, cfg)).toBe(Rating.Hard);
  });

  it('objetivas: error = Again fijo; acierto = Good por defecto o lo que elija', () => {
    expect(toRating({ kind: 'objective', correct: false, chosen: Rating.Easy }, cfg)).toBe(Rating.Again);
    expect(toRating({ kind: 'objective', correct: true }, cfg)).toBe(Rating.Good);
    expect(toRating({ kind: 'objective', correct: true, chosen: Rating.Easy }, cfg)).toBe(Rating.Easy);
  });

  it.each([
    [1, false, Rating.Good],
    [1, true, Rating.Easy],
    [0.8, false, Rating.Hard],
    [0.79, false, Rating.Again],
    [0, false, Rating.Again],
  ])('con puntaje %s (Easy=%s) → %s', (score, upgradeToEasy, expected) => {
    expect(toRating({ kind: 'scored', score, upgradeToEasy }, cfg)).toBe(expected);
  });

  it('AG4: los cortes de puntaje salen de la config', () => {
    const strict = { ...cfg, exercise: { goodMinScore: 1, hardMinScore: 0.9 } };
    expect(toRating({ kind: 'scored', score: 0.85 }, cfg)).toBe(Rating.Hard);
    expect(toRating({ kind: 'scored', score: 0.85 }, strict)).toBe(Rating.Again);
  });

  it('rechaza puntajes fuera de [0, 1]', () => {
    expect(() => toRating({ kind: 'scored', score: 1.2 }, cfg)).toThrow('score_out_of_range');
    expect(() => toRating({ kind: 'scored', score: Number.NaN }, cfg)).toThrow('score_out_of_range');
  });

  it('V/F con justificación', () => {
    expect(
      toRating({ kind: 'true_false_justify', verdictCorrect: false, justification: 'sufficient' }, cfg),
    ).toBe(Rating.Again);
    expect(
      toRating({ kind: 'true_false_justify', verdictCorrect: true, justification: 'sufficient' }, cfg),
    ).toBe(Rating.Good);
    expect(toRating({ kind: 'true_false_justify', verdictCorrect: true, justification: 'weak' }, cfg)).toBe(
      Rating.Hard,
    );
  });

  it.each([
    [false, 3, Rating.Again],
    [true, 3, Rating.Good],
    [true, 2, Rating.Hard],
    [true, 1, Rating.Hard],
  ] as const)('P7: simulacro correcto=%s con confianza %s → %s', (correct, confidence, expected) => {
    expect(toRating({ kind: 'exam', correct, confidence }, cfg)).toBe(expected);
  });

  it('AG4: el umbral de confianza alta sale de la config', () => {
    const lenient = { ...cfg, exam: { ...cfg.exam, highConfidenceMin: 2 } };
    expect(toRating({ kind: 'exam', correct: true, confidence: 2 }, cfg)).toBe(Rating.Hard);
    expect(toRating({ kind: 'exam', correct: true, confidence: 2 }, lenient)).toBe(Rating.Good);
  });
});

describe('puntajes de ejercicios', () => {
  it('secuencia: perfecta = 1, invertida = 0, un intercambio de 4 = 5/6', () => {
    expect(sequenceScore(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toBe(1);
    expect(sequenceScore(['d', 'c', 'b', 'a'], ['a', 'b', 'c', 'd'])).toBe(0);
    expect(sequenceScore(['b', 'a', 'c', 'd'], ['a', 'b', 'c', 'd'])).toBeCloseTo(5 / 6);
    expect(sequenceScore(['a'], ['a'])).toBe(1);
  });

  it('secuencia: rechaza respuestas con otros elementos o repetidos', () => {
    expect(() => sequenceScore(['a', 'x'], ['a', 'b'])).toThrow('sequence_mismatch');
    expect(() => sequenceScore(['a', 'a'], ['a', 'b'])).toThrow('sequence_mismatch');
    expect(() => sequenceScore(['a'], ['a', 'b'])).toThrow('sequence_mismatch');
  });

  it('fracción: aciertos / total y rechaza valores imposibles', () => {
    expect(fractionScore(3, 4)).toBe(0.75);
    expect(() => fractionScore(5, 4)).toThrow('fraction_out_of_range');
    expect(() => fractionScore(1, 0)).toThrow('fraction_out_of_range');
  });
});
