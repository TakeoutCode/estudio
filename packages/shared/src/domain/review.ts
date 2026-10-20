import { z } from 'zod';

// Repasos (R3, LEARNING-DESIGN §4). El ReviewLog es solo de inserción (SYNC §1).

/** Calificaciones FSRS. Los valores coinciden con ts-fsrs. */
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Rating = (typeof Rating)[keyof typeof Rating];
export const RatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const NoteKindSchema = z.enum(['basic', 'cloze', 'image_occlusion', 'type_answer', 'multiple_choice']);
export type NoteKind = z.infer<typeof NoteKindSchema>;

export const ExerciseKindSchema = z.enum([
  'clinical_case',
  'sequence',
  'matching',
  'label_image',
  'true_false_justify',
  'open_question',
]);
export type ExerciseKind = z.infer<typeof ExerciseKindSchema>;

/** Foto del tipo de nota o ejercicio al momento del repaso: el "tipo" de R3. */
export const CardKindSchema = z.enum([...NoteKindSchema.options, ...ExerciseKindSchema.options]);
export type CardKind = z.infer<typeof CardKindSchema>;

export const ReviewTypeSchema = z.enum(['learn', 'review', 'exam', 'contrast']);
export type ReviewType = z.infer<typeof ReviewTypeSchema>;

/** Confianza 1-3 antes de revelar (R6). */
export const ConfidenceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ReviewLogSchema = z
  .object({
    id: z.uuid(),
    cardId: z.uuid(),
    cardKind: CardKindSchema,
    reviewedAt: z.number().int().nonnegative(),
    rating: RatingSchema,
    durationMs: z.number().int().nonnegative(),
    type: ReviewTypeSchema,
    confidence: ConfidenceSchema.nullable(),
    sessionId: z.uuid(),
    deviceId: z.uuid(),
    answer: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ReviewLog = z.infer<typeof ReviewLogSchema>;
