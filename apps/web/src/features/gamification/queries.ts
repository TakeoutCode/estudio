import type { GamificationConfig, Reward, RewardRedemption } from '@estudio/shared';
import type { GamificationInput } from '@estudio/srs';
import { useLiveQuery } from 'dexie-react-hooks';
import { alive, db, type EstudioDb } from '@/db/schema';
import { readGamificationConfig, readProfile } from '@/db/settings';

/**
 * UX10: lo que el worker necesita para XP, nivel, monedas, logros y racha (FE4), leído de Dexie
 * (ARC3). Solo los campos que usa srs, para no copiar respuestas al worker. `null` si la
 * gamificación está apagada o sin responder: entonces no se calcula nada.
 */
export async function loadGamificationInput(
  database: EstudioDb = db,
  now: number = Date.now(),
): Promise<GamificationInput | null> {
  // Una sola espera: con async nativo, liveQuery deja de observar lo que se lee después del
  // primer `await`, y el saldo no cambiaría al canjear.
  const [config, profile, logs, blocks, redemptions] = await Promise.all([
    readGamificationConfig(database),
    readProfile(database),
    database.reviewLogs.toArray(),
    database.timerBlockLogs.toArray(),
    database.rewardRedemptions.toArray(),
  ]);
  if (config.enabled !== true) return null;
  return {
    logs: logs.map(({ reviewedAt, type, cardKind }) => ({ reviewedAt, type, cardKind })),
    blocks: blocks.map(({ kind, outcome, endedAt }) => ({ kind, outcome, endedAt })),
    redemptions: redemptions.map(({ cost }) => ({ cost })),
    config,
    now,
    timeZone: profile.timeZone,
  };
}

/** Solo con la gamificación activa: apagada, Hoy no lee el log completo. */
export const useGamificationInput = (enabled: boolean): GamificationInput | null | undefined =>
  useLiveQuery(() => (enabled ? loadGamificationInput(db, Date.now()) : null), [enabled]);

/**
 * UX6: lo respondido y los bloques cerrados después de `since`, por índice: durante una sesión
 * son pocas filas, así que no se recorre el log en el hilo principal (FE9).
 */
export const useAnsweredSince = (
  since: number | null,
): Pick<GamificationInput, 'logs' | 'blocks'> | null | undefined =>
  useLiveQuery(async () => {
    if (since === null) return null;
    const [logs, blocks] = await Promise.all([
      db.reviewLogs.where('reviewedAt').above(since).toArray(),
      db.timerBlockLogs.where('endedAt').above(since).toArray(),
    ]);
    return { logs, blocks };
  }, [since]);

/** UX10: `enabled` es null hasta que ella responda en el onboarding. */
export const useGamificationConfig = (): GamificationConfig | undefined =>
  useLiveQuery(() => readGamificationConfig(db), []);

/** AG6: las fechas de logros y canjes se muestran en su zona. */
export const useTimeZone = (): string | undefined =>
  useLiveQuery(async () => (await readProfile(db)).timeZone, []);

/** Premios vivos, del más barato al más caro. */
export async function readRewards(database: EstudioDb = db): Promise<Reward[]> {
  const rewards = await alive(database.rewards.toCollection()).toArray();
  return rewards.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'es'));
}

export const useRewards = (): Reward[] | undefined => useLiveQuery(() => readRewards(db), []);

/** Los canjes, del más reciente al más antiguo. */
export const useRedemptions = (): RewardRedemption[] | undefined =>
  useLiveQuery(
    async () => (await db.rewardRedemptions.toArray()).sort((a, b) => b.redeemedAt - a.redeemedAt),
    [],
  );
