import { z } from 'zod';

// Reloj lógico híbrido (SYNC §2, ADR-004). Puro: `now` siempre entra como parámetro.
// La forma codificada es de ancho fijo y ASCII, así que el orden lexicográfico de JS es
// el mismo que el byte a byte de Postgres con COLLATE "C".

export interface Hlc {
  /** Milisegundos de reloj (epoch). */
  readonly wall: number;
  /** Desempate para eventos en el mismo milisegundo. */
  readonly counter: number;
  /** `deviceId` del dispositivo que escribe (UUID). */
  readonly node: string;
}

const WALL_WIDTH = 13;
const COUNTER_WIDTH = 4;
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;
const HLC_PATTERN = /^(\d{13}):([0-9a-z]{4}):([0-9a-f-]{36})$/;

export const HlcStringSchema = z.string().regex(HLC_PATTERN, 'invalid_hlc');

/** Futuro máximo aceptado en un HLC ajeno; protege de un dispositivo con la fecha mal puesta. */
export const MAX_HLC_DRIFT_MS = 24 * 60 * 60 * 1000;

export const initialHlc = (node: string): Hlc => ({ wall: 0, counter: 0, node });

export const encodeHlc = ({ wall, counter, node }: Hlc): string =>
  `${wall.toString().padStart(WALL_WIDTH, '0')}:${counter.toString(36).padStart(COUNTER_WIDTH, '0')}:${node}`;

export function decodeHlc(value: string): Hlc {
  const match = HLC_PATTERN.exec(value);
  if (!match) throw new Error('invalid_hlc');
  const [, wall = '', counter = '', node = ''] = match;
  return { wall: Number(wall), counter: Number.parseInt(counter, 36), node };
}

/** Si el contador se agota en el mismo milisegundo, avanza el reloj lógico 1 ms. */
const bump = (wall: number, counter: number, node: string): Hlc =>
  counter >= MAX_COUNTER ? { wall: wall + 1, counter: 0, node } : { wall, counter: counter + 1, node };

/** Evento local (cada escritura): nunca retrocede aunque el reloj del dispositivo lo haga. */
export function tickHlc(last: Hlc, now: number): Hlc {
  return now > last.wall
    ? { wall: now, counter: 0, node: last.node }
    : bump(last.wall, last.counter, last.node);
}

/** Al aplicar una fila remota: el reloj local queda por delante de todo lo visto. */
export function receiveHlc(local: Hlc, remote: Hlc, now: number): Hlc {
  const wall = Math.max(local.wall, remote.wall, now);
  if (wall === now && now > local.wall && now > remote.wall) return { wall, counter: 0, node: local.node };
  if (local.wall === remote.wall && wall === local.wall) {
    return bump(wall, Math.max(local.counter, remote.counter), local.node);
  }
  return wall === local.wall ? bump(wall, local.counter, local.node) : bump(wall, remote.counter, local.node);
}

/** Compara HLC codificados: negativo si `a` es anterior, 0 si son iguales. */
export const compareHlc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** El servidor rechaza escrituras con HLC demasiado en el futuro (SYNC §3). */
export const isHlcTooFarAhead = (hlc: Hlc, now: number, maxDriftMs = MAX_HLC_DRIFT_MS): boolean =>
  hlc.wall - now > maxDriftMs;
