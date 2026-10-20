import { type Deck, DeckSchema, newId } from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/**
 * FRONTEND FE3: una transacción escribe la entidad, avanza el HLC y la encola en el outbox.
 * Si la validación falla, no se escribe nada.
 */
async function saveDeck(
  database: EstudioDb,
  now: number,
  build: (stamp: { hlc: string; updatedAt: number }) => Deck | Promise<Deck>,
): Promise<Deck> {
  const deck = await database.transaction(
    'rw',
    [database.decks, database.outbox, database.meta],
    async () => {
      const hlc = await nextHlc(database, now);
      const row = DeckSchema.parse(await build({ hlc, updatedAt: hlcWall(hlc) }));
      await writeAndQueue(database, 'deck', row, now);
      return row;
    },
  );
  syncScheduler.poke();
  return deck;
}

export function createDeck(
  input: { readonly name: string; readonly description?: string | null },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Deck> {
  return saveDeck(database, now, (stamp) => ({
    id: newId(),
    name: input.name,
    description: input.description ?? null,
    deletedAt: null,
    ...stamp,
  }));
}

export function renameDeck(
  id: string,
  name: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Deck> {
  return saveDeck(database, now, async (stamp) => ({ ...(await existing(database, id)), name, ...stamp }));
}

/** Borrado lógico (SYNC §6): escribe `deletedAt` y viaja como cualquier otra edición. */
export function deleteDeck(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Deck> {
  return saveDeck(database, now, async (stamp) => ({
    ...(await existing(database, id)),
    ...stamp,
    deletedAt: stamp.updatedAt,
  }));
}

async function existing(database: EstudioDb, id: string): Promise<Deck> {
  const deck = await database.decks.get(id);
  if (deck?.deletedAt !== null) throw new Error('deck_not_found');
  return deck;
}
