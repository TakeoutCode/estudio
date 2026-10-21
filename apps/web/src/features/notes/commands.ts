import {
  type Card,
  cardIdFor,
  cardOrdinals,
  CardSchema,
  DeckSchema,
  newId,
  type Note,
  type NoteContent,
  NoteSchema,
  tagKey,
  TagSchema,
  TopicSchema,
} from '@estudio/shared';
import { isLeech } from '@estudio/srs';
import { hlcWall, nextHlc } from '@/db/clock';
import { projectCards } from '@/db/projection';
import { alive, db as defaultDb, type EstudioDb } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { writeAndQueue } from '@/db/write';
import { mediaTables, type StagedImage, stageImageAsset } from '@/features/media';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

/**
 * Tablas de una escritura de notas: nota, sus Cards, su proyección, su imagen (FE8), outbox y
 * reloj (FE3).
 */
export const noteTables = (database: EstudioDb) => [
  database.decks,
  database.topics,
  database.tags,
  database.notes,
  database.cards,
  database.cardStates,
  database.reviewLogs,
  database.userSettings,
  ...mediaTables(database),
  database.outbox,
  database.meta,
];

async function write<T>(database: EstudioDb, work: () => Promise<T>): Promise<T> {
  const result = await database.transaction('rw', noteTables(database), work);
  syncScheduler.poke();
  return result;
}

async function stamp(database: EstudioDb, now: number) {
  const hlc = await nextHlc(database, now);
  return { hlc, updatedAt: hlcWall(hlc) };
}

/** Mazo existente, o uno nuevo que se crea en la misma transacción que la nota. */
export type DeckChoice = { readonly id: string } | { readonly name: string };

/**
 * Tema del mazo (LD5, P4): uno existente, uno nuevo que se crea con la nota, o ninguno.
 * Al editar, `undefined` deja el que tenía.
 */
export type TopicChoice =
  { readonly id: string } | { readonly name: string; readonly explanation: string } | null;

/** Etiqueta (diseño): una existente o una nueva que se crea con la nota. */
export type TagChoice = { readonly id: string } | { readonly name: string };

/**
 * Crea la nota. `image`: la imagen que ella eligió para una oclusión (R10); se guarda con la
 * nota y se sube después (FE8).
 */
export function createNote(
  input: {
    readonly deck: DeckChoice;
    readonly content: NoteContent;
    readonly topic?: TopicChoice;
    readonly tags?: readonly TagChoice[];
    readonly image?: StagedImage;
  },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Note> {
  return write(database, async () => {
    await checkImage(database, input.content, input.image, now);
    const deckId = await resolveDeck(database, input.deck, now);
    const note = NoteSchema.parse({
      id: newId(),
      deckId,
      topicId: await resolveTopic(database, input.topic ?? null, deckId, now),
      content: input.content,
      origin: 'manual',
      tagIds: await resolveTags(database, input.tags ?? [], now),
      deletedAt: null,
      ...(await stamp(database, now)),
    });
    await writeAndQueue(database, 'note', note, now);
    await syncCards(database, note, now);
    return note;
  });
}

/**
 * Editar el contenido. Si una de sus Cards estaba para reformular (P3), editarla es
 * reformularla: desde aquí solo cuentan los lapsos nuevos.
 */
/**
 * Edita la nota. Con `deck`, la mueve a otro mazo: sus tarjetas y su historial FSRS no
 * cambian, y como los temas son de cada mazo, el tema tiene que ser del mazo nuevo (sin
 * `topic`, queda sin tema).
 */
export function updateNote(
  id: string,
  input: {
    readonly content: NoteContent;
    readonly topic?: TopicChoice;
    readonly deck?: DeckChoice;
    /** `undefined` deja las que tenía. */
    readonly tags?: readonly TagChoice[];
  },
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<Note> {
  return write(database, async () => {
    const current = await existing(database, id);
    await checkImage(database, input.content, undefined, now);
    const deckId = input.deck === undefined ? current.deckId : await resolveDeck(database, input.deck, now);
    const moved = deckId !== current.deckId;
    const topicId =
      input.topic === undefined
        ? moved
          ? null
          : current.topicId
        : await resolveTopic(database, input.topic, deckId, now);
    const note = NoteSchema.parse({
      ...current,
      deckId,
      topicId,
      content: input.content,
      tagIds: input.tags === undefined ? current.tagIds : await resolveTags(database, input.tags, now),
      ...(await stamp(database, now)),
    });
    await writeAndQueue(database, 'note', note, now);
    await syncCards(database, note, now, { reformulated: true });
    return note;
  });
}

/**
 * Al borrar una etiqueta, sus notas la pierden: cada una es su propia escritura LWW (SY5).
 * Llamar dentro de una transacción que incluya `noteTables`.
 */
export async function removeTagFromNotes(database: EstudioDb, tagId: string, now: number): Promise<void> {
  const notes = await alive(database.notes.where('tagIds').equals(tagId)).toArray();
  for (const note of notes) {
    await writeAndQueue(
      database,
      'note',
      NoteSchema.parse({
        ...note,
        tagIds: note.tagIds.filter((id) => id !== tagId),
        ...(await stamp(database, now)),
      }),
      now,
    );
  }
}

/** Borrado lógico (SYNC §6) con sus Cards; los ReviewLog se conservan (SYNC §5). */
export function deleteNote(id: string, { database = defaultDb, now = Date.now() }: CommandOptions = {}) {
  return write(database, async () => softDeleteNote(database, await existing(database, id), now));
}

/**
 * SY5: borra en cascada las notas de un mazo. Llamar dentro de una transacción que incluya
 * `noteTables`.
 */
export async function softDeleteNotesOfDeck(database: EstudioDb, deckId: string, now: number): Promise<void> {
  const notes = await database.notes.where('deckId').equals(deckId).toArray();
  for (const note of notes) {
    if (note.deletedAt === null) await softDeleteNote(database, note, now);
  }
}

/**
 * Al borrar un tema, sus notas quedan sin tema: cada una es su propia escritura LWW (SY5).
 * Llamar dentro de una transacción que incluya `noteTables`.
 */
export async function clearTopicOfNotes(database: EstudioDb, topicId: string, now: number): Promise<void> {
  const notes = await database.notes.filter((n) => n.topicId === topicId && n.deletedAt === null).toArray();
  for (const note of notes) {
    await writeAndQueue(
      database,
      'note',
      NoteSchema.parse({ ...note, topicId: null, ...(await stamp(database, now)) }),
      now,
    );
  }
}

async function softDeleteNote(database: EstudioDb, note: Note, now: number): Promise<Note> {
  const meta = await stamp(database, now);
  const deleted = NoteSchema.parse({ ...note, ...meta, deletedAt: meta.updatedAt });
  await writeAndQueue(database, 'note', deleted, now);
  await syncCards(database, deleted, now);
  return deleted;
}

/**
 * Deja las Cards de la nota iguales a las que genera su contenido (LD §1): crea las que
 * faltan (o revive las borradas, con su historial), borra las que sobran y reproyecta.
 */
async function syncCards(
  database: EstudioDb,
  note: Note,
  now: number,
  { reformulated = false } = {},
): Promise<void> {
  const wanted = new Set(note.deletedAt === null ? cardOrdinals(note.content) : []);
  const current = new Map(
    (await database.cards.where('noteId').equals(note.id).toArray()).map((c) => [c.ordinal, c]),
  );
  const config = reformulated ? await readStudyConfig(database) : null;
  const touched: string[] = [];
  const save = async (card: Omit<Card, 'hlc' | 'updatedAt'>, { remove = false } = {}) => {
    const meta = await stamp(database, now);
    const row = CardSchema.parse({ ...card, ...meta, deletedAt: remove ? meta.updatedAt : card.deletedAt });
    await writeAndQueue(database, 'card', row, now);
    touched.push(row.id);
  };

  for (const ordinal of wanted) {
    const card = current.get(ordinal);
    if (card?.deletedAt !== null) {
      await save({
        id: cardIdFor(note.id, ordinal),
        noteId: note.id,
        ordinal,
        createdAt: card?.createdAt ?? now,
        lapseBaseline: card?.lapseBaseline ?? 0,
        deletedAt: null,
      });
      continue;
    }
    const state = await database.cardStates.get(card.id);
    if (config && state && isLeech({ state, lapseBaseline: card.lapseBaseline }, config.planner)) {
      await save({ ...card, lapseBaseline: state.lapses });
    }
  }
  for (const card of current.values()) {
    if (!wanted.has(card.ordinal) && card.deletedAt === null) await save(card, { remove: true });
  }
  await projectCards(database, touched);
}

/**
 * FE8: una oclusión apunta a una imagen que existe aquí: la que llega con la nota (y se guarda
 * ahora) o una ya guardada. Así la nota nunca viaja antes que su asset (BE2).
 */
async function checkImage(
  database: EstudioDb,
  content: NoteContent,
  image: StagedImage | undefined,
  now: number,
): Promise<void> {
  if (content.kind !== 'image_occlusion') {
    if (image) throw new Error('image_without_occlusion');
    return;
  }
  if (image) {
    if (image.assetId !== content.imageAssetId) throw new Error('image_mismatch');
    await stageImageAsset(database, image, now);
    return;
  }
  const asset = await database.mediaAssets.get(content.imageAssetId);
  if (asset?.deletedAt !== null) throw new Error('image_not_found');
}

async function resolveDeck(database: EstudioDb, choice: DeckChoice, now: number): Promise<string> {
  if ('id' in choice) {
    const deck = await database.decks.get(choice.id);
    if (deck?.deletedAt !== null) throw new Error('deck_not_found');
    return deck.id;
  }
  const deck = DeckSchema.parse({
    id: newId(),
    name: choice.name,
    description: null,
    deletedAt: null,
    ...(await stamp(database, now)),
  });
  await writeAndQueue(database, 'deck', deck, now);
  return deck.id;
}

/** El tema tiene que ser del mismo mazo que la nota. */
async function resolveTopic(
  database: EstudioDb,
  choice: TopicChoice,
  deckId: string,
  now: number,
): Promise<string | null> {
  if (choice === null) return null;
  if ('id' in choice) {
    const topic = await database.topics.get(choice.id);
    if (topic?.deletedAt !== null || topic.deckId !== deckId) throw new Error('topic_not_found');
    return topic.id;
  }
  const topic = TopicSchema.parse({
    id: newId(),
    deckId,
    name: choice.name,
    explanation: choice.explanation,
    deletedAt: null,
    ...(await stamp(database, now)),
  });
  await writeAndQueue(database, 'topic', topic, now);
  return topic.id;
}

/**
 * Las etiquetas elegidas, sin repetir. Una nueva cuyo nombre ya existe (sin contar mayúsculas
 * ni acentos, `tagKey`) usa la que ya está; si no, se crea en la misma transacción. Una que se
 * borró en otro dispositivo mientras editaba se omite: borrarla es quitarla de sus notas.
 */
async function resolveTags(
  database: EstudioDb,
  choices: readonly TagChoice[],
  now: number,
): Promise<string[]> {
  const byKey = new Map(
    (await alive(database.tags.toCollection()).toArray()).map((tag) => [tagKey(tag.name), tag.id]),
  );
  const ids: string[] = [];
  for (const choice of choices) {
    let id: string;
    if ('id' in choice) {
      const tag = await database.tags.get(choice.id);
      if (tag?.deletedAt !== null) continue;
      id = tag.id;
    } else {
      const known = byKey.get(tagKey(choice.name));
      if (known) {
        id = known;
      } else {
        const tag = TagSchema.parse({
          id: newId(),
          name: choice.name,
          deletedAt: null,
          ...(await stamp(database, now)),
        });
        await writeAndQueue(database, 'tag', tag, now);
        byKey.set(tagKey(tag.name), tag.id);
        id = tag.id;
      }
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function existing(database: EstudioDb, id: string): Promise<Note> {
  const note = await database.notes.get(id);
  if (note?.deletedAt !== null) throw new Error('note_not_found');
  return note;
}
