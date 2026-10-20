import { decodeHlc, encodeHlc, initialHlc, newId, receiveHlc, tickHlc } from '@estudio/shared';
import { z } from 'zod';
import type { EstudioDb } from './schema';

// Reloj lógico del dispositivo (SYNC SY2). Llamar siempre dentro de una transacción `rw`
// que incluya `db.meta`, junto con la escritura que fecha.

const DEVICE_KEY = 'deviceId';
const HLC_KEY = 'hlc';

/** ID estable de esta instalación; se genera la primera vez (SYNC §5). */
export async function deviceId(database: EstudioDb): Promise<string> {
  const stored = z.uuid().safeParse((await database.meta.get(DEVICE_KEY))?.value);
  if (stored.success) return stored.data;
  const id = newId();
  await database.meta.put({ key: DEVICE_KEY, value: id });
  return id;
}

async function currentHlc(database: EstudioDb) {
  const stored = z.string().safeParse((await database.meta.get(HLC_KEY))?.value);
  return stored.success ? decodeHlc(stored.data) : initialHlc(await deviceId(database));
}

/** Siguiente HLC de este dispositivo, ya persistido. */
export async function nextHlc(database: EstudioDb, now: number): Promise<string> {
  const next = encodeHlc(tickHlc(await currentHlc(database), now));
  await database.meta.put({ key: HLC_KEY, value: next });
  return next;
}

/** Al aplicar filas remotas: el reloj local queda por delante de todo lo visto (SY2). */
export async function observeHlc(database: EstudioDb, remote: string, now: number): Promise<void> {
  const merged = receiveHlc(await currentHlc(database), decodeHlc(remote), now);
  await database.meta.put({ key: HLC_KEY, value: encodeHlc(merged) });
}

/** `updatedAt` de una entidad: la parte de reloj de su HLC (SYNC §1). */
export const hlcWall = (hlc: string): number => decodeHlc(hlc).wall;
