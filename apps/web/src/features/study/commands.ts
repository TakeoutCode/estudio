import {
  type Confidence,
  newId,
  type Rating,
  type ReviewLog,
  ReviewLogSchema,
  type SelfExplanation,
  SelfExplanationSchema,
} from '@estudio/shared';
import { type CardState, createScheduler, newCardState, reviewTypeFor } from '@estudio/srs';
import { deviceId, hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { syncScheduler } from '@/sync';

export interface AnswerInput {
  readonly cardId: string;
  readonly rating: Rating;
  /** De mostrar la tarjeta a calificarla. */
  readonly durationMs: number;
  readonly sessionId: string;
  /** R6: solo si se pidió antes de revelar. */
  readonly confidence: Confidence | null;
  /** LD §4: lo que escribió o eligió, en las tarjetas con calificación automática. */
  readonly answer?: Record<string, unknown>;
}

/**
 * R3 y SYNC SY6: el ReviewLog completo, la proyección y el outbox en una sola transacción,
 * antes de mostrar la siguiente tarjeta. Si la app se cierra después, no se pierde nada.
 * En el hilo principal va solo el paso de FSRS de esta respuesta (FRONTEND FE4).
 */
export async function answerCard(
  input: AnswerInput,
  { database = defaultDb, now = Date.now() }: { readonly database?: EstudioDb; readonly now?: number } = {},
): Promise<{ log: ReviewLog; state: CardState }> {
  const result = await database.transaction(
    'rw',
    [
      database.cards,
      database.notes,
      database.cardStates,
      database.reviewLogs,
      database.userSettings,
      database.outbox,
      database.meta,
    ],
    async () => {
      const card = await database.cards.get(input.cardId);
      const note = card?.deletedAt === null ? await database.notes.get(card.noteId) : undefined;
      if (!card || note?.deletedAt !== null) throw new Error('card_not_found');
      const config = await readStudyConfig(database);
      const before = (await database.cardStates.get(card.id)) ?? newCardState(card.id, card.createdAt);
      const log = ReviewLogSchema.parse({
        id: newId(),
        cardId: card.id,
        cardKind: note.content.kind, // foto del tipo al responder (R3)
        reviewedAt: now,
        rating: input.rating,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        type: reviewTypeFor(before.phase),
        confidence: input.confidence,
        sessionId: input.sessionId,
        deviceId: await deviceId(database),
        ...(input.answer ? { answer: input.answer } : {}),
      });
      const state = createScheduler(config.fsrs).apply(before, log);
      await writeAndQueue(database, 'reviewLog', log, now);
      await database.cardStates.put(state);
      return { log, state };
    },
  );
  syncScheduler.poke();
  return result;
}

/**
 * LD5: "Explícalo con tus palabras" antes de la primera tarjeta nueva de un tema. No es un
 * repaso (R15): no escribe ReviewLog ni toca FSRS.
 */
export async function saveSelfExplanation(
  input: { readonly topicId: string; readonly text: string },
  { database = defaultDb, now = Date.now() }: { readonly database?: EstudioDb; readonly now?: number } = {},
): Promise<SelfExplanation> {
  const saved = await database.transaction(
    'rw',
    [database.topics, database.selfExplanations, database.outbox, database.meta],
    async () => {
      const topic = await database.topics.get(input.topicId);
      if (topic?.deletedAt !== null) throw new Error('topic_not_found');
      const hlc = await nextHlc(database, now);
      const row = SelfExplanationSchema.parse({
        id: newId(),
        topicId: topic.id,
        text: input.text,
        writtenAt: now,
        hlc,
        updatedAt: hlcWall(hlc),
        deletedAt: null,
      });
      await writeAndQueue(database, 'selfExplanation', row, now);
      return row;
    },
  );
  syncScheduler.poke();
  return saved;
}
