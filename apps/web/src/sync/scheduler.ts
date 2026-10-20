import { ApiError } from '@/lib/api';

// Cuándo sincronizar (SYNC SY8). iOS no tiene Background Sync: lo respondido sin red ya
// está seguro en Dexie (R3) y sale en la próxima oportunidad.

export type SyncState = 'idle' | 'syncing' | 'offline' | 'retrying' | 'signed_out' | 'outdated';

/** Parámetros operativos de SY8 (no son umbrales de estudio). */
export const SYNC_TIMING = {
  pokeDebounceMs: 2_000,
  visibleIntervalMs: 60_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 5 * 60_000,
} as const;

export interface SchedulerEnv {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
  isOnline(): boolean;
  hasSession(): boolean;
  /** Ejecuta `task` solo si ninguna otra pestaña está sincronizando. */
  exclusive(task: () => Promise<void>): Promise<void>;
  onState(state: SyncState): void;
}

export class SyncScheduler {
  private timer: unknown;
  private running = false;
  private again = false;
  private failures = 0;
  private paused: 'signed_out' | 'outdated' | null = null;

  constructor(
    private readonly run: () => Promise<unknown>,
    private readonly env: SchedulerEnv,
  ) {}

  /** Tras cada escritura local: espera 2 s para juntar varias en un solo push. */
  poke(): void {
    this.schedule(SYNC_TIMING.pokeDebounceMs);
  }

  /** `online`, volver a primer plano, abrir la app, intervalo visible. */
  now(): void {
    this.schedule(0);
  }

  /** Tras iniciar sesión o actualizar la app. */
  resume(): void {
    this.paused = null;
    this.failures = 0;
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.paused) return;
    if (this.timer !== undefined) this.env.clearTimeout(this.timer);
    this.timer = this.env.setTimeout(() => {
      this.timer = undefined;
      void this.execute();
    }, ms);
  }

  private async execute(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    if (!this.env.hasSession()) {
      this.pause('signed_out');
      return;
    }
    if (!this.env.isOnline()) {
      this.env.onState('offline');
      return;
    }
    this.running = true;
    this.env.onState('syncing');
    try {
      await this.env.exclusive(async () => {
        await this.run();
      });
      this.failures = 0;
      this.env.onState('idle');
    } catch (error) {
      this.handleFailure(error);
    } finally {
      this.running = false;
    }
    if (this.again) {
      this.again = false;
      this.schedule(0);
    }
  }

  private handleFailure(error: unknown): void {
    if (error instanceof ApiError && error.code === 'unauthorized') {
      this.pause('signed_out');
      return;
    }
    if (error instanceof ApiError && error.code === 'contract_outdated') {
      this.pause('outdated'); // ARC6: se reanuda al actualizar la PWA
      return;
    }
    this.failures += 1;
    const backoff = Math.min(SYNC_TIMING.backoffMaxMs, SYNC_TIMING.backoffBaseMs * 2 ** (this.failures - 1));
    const jittered = backoff * (0.5 + this.env.random() / 2);
    const retryAfter = error instanceof ApiError ? (error.retryAfterMs ?? 0) : 0;
    this.env.onState(error instanceof ApiError && error.code === 'network' ? 'offline' : 'retrying');
    this.schedule(Math.max(jittered, retryAfter));
  }

  private pause(reason: 'signed_out' | 'outdated'): void {
    this.paused = reason;
    this.env.onState(reason);
  }
}
