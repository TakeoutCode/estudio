import { type ContrastGroup, ContrastGroupSchema, newId } from '@estudio/shared';
import { drawContrastArm } from '@estudio/srs';
import { hlcWall, nextHlc } from '@/db/clock';
import { alive, db as defaultDb, type EstudioDb } from '@/db/schema';
import { writeAndQueue } from '@/db/write';
import { syncScheduler } from '@/sync';

interface CommandOptions {
  readonly database?: EstudioDb;
  readonly now?: number;
}

export interface ContrastGroupInput {
  readonly name: string;
  readonly noteIds: readonly string[];
}

/** LD10: semilla del sorteo; se guarda con el grupo para poder auditarlo. */
export const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

async function write<T>(database: EstudioDb, work: () => Promise<T>): Promise<T> {
  const result = await database.transaction(
    'rw',
    [database.contrastGroups, database.outbox, database.meta],
    work,
  );
  syncScheduler.poke();
  return result;
}

async function stamp(database: EstudioDb, now: number) {
  const hlc = await nextHlc(database, now);
  return { hlc, updatedAt: hlcWall(hlc) };
}

/**
 * R9, LD10: marca unas notas como confundibles. El brazo del A/B se sortea aquí, una sola vez:
 * al de menos grupos y, si están parejos, según la semilla.
 */
export function createContrastGroup(
  input: ContrastGroupInput,
  {
    database = defaultDb,
    now = Date.now(),
    seed = randomSeed(),
  }: CommandOptions & { readonly seed?: number } = {},
): Promise<ContrastGroup> {
  return write(database, async () => {
    const groups = await alive(database.contrastGroups.toCollection()).toArray();
    const counts = { contrast: 0, control: 0 };
    for (const g of groups) counts[g.abArm] += 1;
    const group = ContrastGroupSchema.parse({
      id: newId(),
      name: input.name,
      noteIds: [...input.noteIds],
      abSeed: seed,
      abArm: drawContrastArm(seed, counts),
      deletedAt: null,
      ...(await stamp(database, now)),
    });
    await writeAndQueue(database, 'contrastGroup', group, now);
    return group;
  });
}

/** Cambia nombre o miembros; el brazo y su semilla no cambian (LD10). */
export function updateContrastGroup(
  id: string,
  input: ContrastGroupInput,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
): Promise<ContrastGroup> {
  return write(database, async () => {
    const current = await existing(database, id);
    const group = ContrastGroupSchema.parse({
      ...current,
      name: input.name,
      noteIds: [...input.noteIds],
      ...(await stamp(database, now)),
    });
    await writeAndQueue(database, 'contrastGroup', group, now);
    return group;
  });
}

/** Borrado lógico (SYNC §6): sus notas y su historial no cambian. */
export function deleteContrastGroup(
  id: string,
  { database = defaultDb, now = Date.now() }: CommandOptions = {},
) {
  return write(database, async () => {
    const current = await existing(database, id);
    const meta = await stamp(database, now);
    await writeAndQueue(
      database,
      'contrastGroup',
      ContrastGroupSchema.parse({ ...current, ...meta, deletedAt: meta.updatedAt }),
      now,
    );
  });
}

async function existing(database: EstudioDb, id: string): Promise<ContrastGroup> {
  const group = await database.contrastGroups.get(id);
  if (group?.deletedAt !== null) throw new Error('contrast_group_not_found');
  return group;
}
