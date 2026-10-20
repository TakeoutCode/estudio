import { type Deck, DeckSchema, newId } from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { db as defaultDb, type EstudioDb } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { noteTables, softDeleteNotesOfDeck } from '@/features/notes';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/**
 * FRONTEND FE3: una transacción escribe la entidad, avanza el HLC y la encola en el outbox.
 * Si la validación falla, no se escribe nada. `cascade` corre en la misma transacción.
 */
async function saveDeck(
  database: EstudioDb,
  now: number,
  build: (stamp: { hlc: string; updatedAt: number }) => Deck | Promise<Deck>,
  cascade?: (deck: Deck) => Promise<void>,
): Promise<Deck> {
  const deck = await database.transaction('rw', noteTables(database), async () => {
    const hlc = await nextHlc(database, now);
    const row = DeckSchema.parse(await build({ hlc, updatedAt: hlcWall(hlc) }));
    await writeAndQueue(database, 'deck', row, now);
    await cascade?.(row);
    return row;
  });
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

/**
 * Borrado lógico (SYNC §6): escribe `deletedAt` y viaja como cualquier otra edición. SY5:
 * sus notas y tarjetas se borran en la misma transacción, cada una como su propia escritura.
 */
export function deleteDeck(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Deck> {
  return saveDeck(
    database,
    now,
    async (stamp) => ({ ...(await existing(database, id)), ...stamp, deletedAt: stamp.updatedAt }),
    (deck) => softDeleteNotesOfDeck(database, deck.id, now),
  );
}

async function existing(database: EstudioDb, id: string): Promise<Deck> {
  const deck = await database.decks.get(id);
  if (deck?.deletedAt !== null) throw new Error('deck_not_found');
  return deck;
}
