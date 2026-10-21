import {
  type Deck,
  DeckSchema,
  newId,
  type Tag,
  tagKey,
  TagSchema,
  type Topic,
  TopicSchema,
} from '@estudio/shared';
import { hlcWall, nextHlc } from '@/db/clock';
import { alive, db as defaultDb, type EstudioDb } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { clearTopicOfNotes, noteTables, removeTagFromNotes, softDeleteNotesOfDeck } from '@/features/notes';
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
    pausedAt: null,
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

/** Nombre y descripción del mazo; una descripción vacía se guarda como `null`. */
export function updateDeck(
  id: string,
  input: { readonly name: string; readonly description: string },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Deck> {
  const description = input.description.trim() === '' ? null : input.description;
  return saveDeck(database, now, async (stamp) => ({
    ...(await existing(database, id)),
    name: input.name,
    description,
    ...stamp,
  }));
}

/**
 * Pausar o reanudar (*diseño*): en pausa, sus tarjetas salen de Hoy, de la carga y de los
 * recordatorios. Solo cambia `pausedAt`: FSRS no se toca (LD9) y al reanudar lo vencido entra
 * con P8. Viaja por LWW como cualquier edición.
 */
export function setDeckPaused(
  id: string,
  paused: boolean,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Deck> {
  return saveDeck(database, now, async (stamp) => ({
    ...(await existing(database, id)),
    ...stamp,
    pausedAt: paused ? stamp.updatedAt : null,
  }));
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
    async (deck) => {
      await softDeleteTopicsOfDeck(database, deck.id, now);
      await softDeleteNotesOfDeck(database, deck.id, now);
    },
  );
}

/** LD5: nombre y explicación del tema. */
export function updateTopic(
  id: string,
  input: { readonly name: string; readonly explanation: string },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Topic> {
  return saveTopic(database, now, async (stamp) => ({
    ...(await existingTopic(database, id)),
    name: input.name,
    explanation: input.explanation,
    ...stamp,
  }));
}

/**
 * Borrado lógico del tema (SYNC §6). Sus notas quedan sin tema, cada una como su propia
 * escritura; sus autoexplicaciones se conservan, porque son de ella.
 */
export function deleteTopic(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Topic> {
  return saveTopic(
    database,
    now,
    async (stamp) => ({ ...(await existingTopic(database, id)), ...stamp, deletedAt: stamp.updatedAt }),
    (topic) => clearTopicOfNotes(database, topic.id, now),
  );
}

async function saveTopic(
  database: EstudioDb,
  now: number,
  build: (stamp: { hlc: string; updatedAt: number }) => Promise<Topic>,
  cascade?: (topic: Topic) => Promise<void>,
): Promise<Topic> {
  const topic = await database.transaction('rw', noteTables(database), async () => {
    const hlc = await nextHlc(database, now);
    const row = TopicSchema.parse(await build({ hlc, updatedAt: hlcWall(hlc) }));
    await writeAndQueue(database, 'topic', row, now);
    await cascade?.(row);
    return row;
  });
  syncScheduler.poke();
  return topic;
}

/** SY5: los temas caen con su mazo, cada uno como su propia escritura. */
async function softDeleteTopicsOfDeck(database: EstudioDb, deckId: string, now: number): Promise<void> {
  for (const topic of await database.topics.where('deckId').equals(deckId).toArray()) {
    if (topic.deletedAt !== null) continue;
    const hlc = await nextHlc(database, now);
    const row = TopicSchema.parse({ ...topic, hlc, updatedAt: hlcWall(hlc), deletedAt: hlcWall(hlc) });
    await writeAndQueue(database, 'topic', row, now);
  }
}

async function existingTopic(database: EstudioDb, id: string): Promise<Topic> {
  const topic = await database.topics.get(id);
  if (topic?.deletedAt !== null) throw new Error('topic_not_found');
  return topic;
}

async function existing(database: EstudioDb, id: string): Promise<Deck> {
  const deck = await database.decks.get(id);
  if (deck?.deletedAt !== null) throw new Error('deck_not_found');
  return deck;
}

/** La etiqueta viva con ese nombre (sin contar mayúsculas ni acentos), si hay otra. */
async function tagNamed(database: EstudioDb, name: string, except: string): Promise<Tag | undefined> {
  const key = tagKey(name);
  return alive(database.tags.toCollection())
    .filter((tag) => tag.id !== except && tagKey(tag.name) === key)
    .first();
}

async function existingTag(database: EstudioDb, id: string): Promise<Tag> {
  const tag = await database.tags.get(id);
  if (tag?.deletedAt !== null) throw new Error('tag_not_found');
  return tag;
}

/** Renombra la etiqueta (diseño); otro nombre que ya existe no se repite (`tag_name_taken`). */
export async function renameTag(
  id: string,
  name: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Tag> {
  const tag = await database.transaction('rw', [database.tags, database.outbox, database.meta], async () => {
    if (await tagNamed(database, name, id)) throw new Error('tag_name_taken');
    const hlc = await nextHlc(database, now);
    const row = TagSchema.parse({ ...(await existingTag(database, id)), name, hlc, updatedAt: hlcWall(hlc) });
    await writeAndQueue(database, 'tag', row, now);
    return row;
  });
  syncScheduler.poke();
  return tag;
}

/**
 * Borrado lógico (SYNC §6): sus notas la pierden en la misma transacción, cada una con su
 * escritura LWW (SY5). Las notas y su historial no cambian.
 */
export async function deleteTag(id: string, { database = defaultDb, now = Date.now() }: CommandOptions = {}) {
  await database.transaction('rw', noteTables(database), async () => {
    const hlc = await nextHlc(database, now);
    const updatedAt = hlcWall(hlc);
    const row = TagSchema.parse({
      ...(await existingTag(database, id)),
      hlc,
      updatedAt,
      deletedAt: updatedAt,
    });
    await writeAndQueue(database, 'tag', row, now);
    await removeTagFromNotes(database, id, now);
  });
  syncScheduler.poke();
}
