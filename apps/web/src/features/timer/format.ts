const SECOND_MS = 1_000;

/** `m:ss` para el reloj del bloque; los minutos no se cortan en 60 (bloques de 90 min, R7). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / SECOND_MS));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
