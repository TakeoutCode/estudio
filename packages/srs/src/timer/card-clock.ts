// Reloj de una tarjeta (STUDY-METHODS R3): la duración que se guarda en el ReviewLog es el
// tiempo con la tarjeta a la vista, de mostrarla a responderla. Pura: cada llamada trae su
// hora (AGENTS AG3). Alimenta P1 (tiempos medianos), P5 (latencia) y el tiempo activo (§5).

/**
 * Lo que detiene el reloj (*diseño*): el descanso del temporizador (§3), la app en segundo
 * plano o con el teléfono bloqueado, y salir de la pantalla de estudio con la tarjeta a medias.
 */
export type CardPause = 'break' | 'hidden' | 'away';

export interface CardClock {
  /** Tiempo a la vista de los tramos ya cerrados. */
  readonly accumulatedMs: number;
  /** Inicio del tramo en curso; `null` mientras haya alguna pausa abierta. */
  readonly runningSince: number | null;
  /** Pausas abiertas. Pueden solaparse: el reloj sigue cuando se cierra la última. */
  readonly pauses: readonly { readonly reason: CardPause; readonly since: number }[];
  /** Con el reloj detenido, el fin más tardío de las pausas ya cerradas: ahí sigue. */
  readonly resumeAt: number;
}

/**
 * Tarjeta presentada en `now`. Las pausas abiertas de `previous` siguen abiertas: son de la
 * pantalla, no de la tarjeta (p. ej. una tarjeta que se presenta con la app oculta).
 */
export function startCardClock(now: number, previous?: CardClock): CardClock {
  const pauses = (previous?.pauses ?? []).map(({ reason }) => ({ reason, since: now }));
  return { accumulatedMs: 0, runningSince: pauses.length > 0 ? null : now, pauses, resumeAt: now };
}

/** Abre una pausa en `at`. Si ya estaba abierta, no cambia nada (misma referencia). */
export function pauseCardClock(clock: CardClock, reason: CardPause, at: number): CardClock {
  if (clock.pauses.some((p) => p.reason === reason)) return clock;
  if (clock.runningSince === null) {
    return { ...clock, pauses: [...clock.pauses, { reason, since: at }] };
  }
  // Una marca anterior al tramo en curso (p. ej. el descanso visto tarde) no quita tiempo ya contado.
  const since = Math.max(at, clock.runningSince);
  return {
    accumulatedMs: clock.accumulatedMs + (since - clock.runningSince),
    runningSince: null,
    pauses: [{ reason, since }],
    resumeAt: since,
  };
}

/** Cierra una pausa en `at`. Si no estaba abierta, no cambia nada (misma referencia). */
export function resumeCardClock(clock: CardClock, reason: CardPause, at: number): CardClock {
  const pause = clock.pauses.find((p) => p.reason === reason);
  if (!pause) return clock;
  const pauses = clock.pauses.filter((p) => p !== pause);
  const resumeAt = Math.max(clock.resumeAt, pause.since, at);
  return { ...clock, pauses, resumeAt, runningSince: pauses.length > 0 ? null : resumeAt };
}

/** Tiempo a la vista hasta `now`. Si el reloj del dispositivo retrocede, no resta lo ya contado. */
export function cardElapsedMs(clock: CardClock, now: number): number {
  const running = clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince);
  return clock.accumulatedMs + running;
}
