import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { BONES_DECK, buildBonesDeck } from './bones-deck.js';

export type SeedOutcome =
  | {
      readonly status: 'created';
      readonly deckId: string;
      readonly topics: number;
      readonly notes: number;
      readonly cards: number;
    }
  | { readonly status: 'exists'; readonly deckId: string };

/**
 * Carga el mazo de huesos en la cuenta `userId` como lo haría un push (SYNC §3): con el lock
 * del usuario tomado antes de asignar `server_seq`, así el pull de sus dispositivos no se
 * salta ninguna fila. Si ya tiene un mazo vivo con ese nombre no escribe nada, para no pisar
 * lo que ella haya editado; si lo borró, se crea otro.
 */
export function seedBonesDeck(
  prisma: PrismaClient,
  { userId, now }: { readonly userId: string; readonly now: number },
): Promise<SeedOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
    const existing = await tx.deck.findFirst({
      where: { userId, name: BONES_DECK.name, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { status: 'exists', deckId: existing.id };

    const { deck, topics, notes, cards } = buildBonesDeck(now);
    const nextSeq = await reserveSeqs(tx, 1 + topics.length + notes.length + cards.length);
    const meta = (row: { hlc: string; updatedAt: number }) => ({
      userId,
      hlc: row.hlc,
      updatedAt: BigInt(row.updatedAt),
      deletedAt: null,
      serverSeq: nextSeq(),
    });

    await tx.deck.create({
      data: { id: deck.id, name: deck.name, description: deck.description, ...meta(deck) },
    });
    await tx.topic.createMany({
      data: topics.map((t) => ({
        id: t.id,
        deckId: t.deckId,
        name: t.name,
        explanation: t.explanation,
        ...meta(t),
      })),
    });
    await tx.note.createMany({
      data: notes.map((n) => ({
        id: n.id,
        deckId: n.deckId,
        topicId: n.topicId,
        kind: n.content.kind,
        content: n.content,
        origin: n.origin,
        ...meta(n),
      })),
    });
    await tx.card.createMany({
      data: cards.map((c) => ({
        id: c.id,
        noteId: c.noteId,
        ordinal: c.ordinal,
        createdAt: BigInt(c.createdAt),
        lapseBaseline: c.lapseBaseline,
        ...meta(c),
      })),
    });
    return {
      status: 'created',
      deckId: deck.id,
      topics: topics.length,
      notes: notes.length,
      cards: cards.length,
    };
  });
}

/**
 * Reserva `n` valores de `sync_seq` de una vez y los entrega en orden: el mazo antes que sus
 * temas, notas y Cards, como llegarían si ella los creara.
 */
async function reserveSeqs(tx: Prisma.TransactionClient, n: number): Promise<() => bigint> {
  const rows = await tx.$queryRaw<{ seq: bigint }[]>`
    SELECT nextval('sync_seq') AS seq FROM generate_series(1, ${n}::int)`;
  const seqs = rows.map((r) => r.seq).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let next = 0;
  return () => {
    const seq = seqs[next++];
    if (seq === undefined) throw new Error('reserveSeqs: se pidieron más server_seq de los reservados');
    return seq;
  };
}
