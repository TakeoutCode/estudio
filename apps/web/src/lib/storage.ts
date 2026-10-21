// FRONTEND FE7: el navegador puede borrar IndexedDB si le falta espacio, salvo con guardado
// persistente. Aquí no se toca Dexie: solo la API de almacenamiento del navegador.

export interface StorageStatus {
  /** Bytes que usa la app en este dispositivo; null si el navegador no lo dice. */
  readonly usage: number | null;
  /** Bytes que el navegador le reserva, aproximado; null si no lo dice. */
  readonly quota: number | null;
  /** null si el navegador no ofrece guardado persistente. */
  readonly persisted: boolean | null;
}

const manager = (): StorageManager | null =>
  typeof navigator !== 'undefined' && 'storage' in navigator ? navigator.storage : null;

export async function storageStatus(): Promise<StorageStatus> {
  const storage = manager();
  if (!storage) return { usage: null, quota: null, persisted: null };
  const [estimate, persisted] = await Promise.all([
    typeof storage.estimate === 'function' ? storage.estimate().catch(() => null) : null,
    typeof storage.persisted === 'function' ? storage.persisted().catch(() => null) : null,
  ]);
  return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted };
}

/**
 * FE7: pide guardado persistente (tras la primera sesión completa o desde Ajustes). Si ya lo
 * tiene no vuelve a pedir. Devuelve si quedó persistente, o null si el navegador no lo ofrece.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  const storage = manager();
  if (!storage || typeof storage.persist !== 'function') return null;
  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}
