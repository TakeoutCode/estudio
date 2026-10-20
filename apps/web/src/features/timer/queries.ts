import type { TimerConfig, TimerSession } from '@estudio/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { z } from 'zod';
import { storedDeviceId } from '@/db/clock';
import { db, SERVER_OFFSET_KEY } from '@/db/schema';
import { readStudyConfig } from '@/db/settings';
import { currentTimerSession } from './commands';

export interface TimerView {
  readonly session: TimerSession | null;
  /** ADR-006: solo el dispositivo dueño mueve el temporizador. */
  readonly isOwner: boolean;
  /** Para pasar `Date.now()` a hora del servidor al repintar (SY7). */
  readonly offsetMs: number;
  readonly config: TimerConfig;
}

export const useTimerView = (): TimerView | undefined =>
  useLiveQuery(async () => {
    const [session, device, study, offset] = await Promise.all([
      currentTimerSession(db),
      storedDeviceId(db),
      readStudyConfig(db),
      db.meta.get(SERVER_OFFSET_KEY),
    ]);
    const offsetMs = z.number().safeParse(offset?.value);
    return {
      session,
      isOwner: session !== null && session.ownerDeviceId === device,
      offsetMs: offsetMs.success ? offsetMs.data : 0,
      config: study.timer,
    };
  }, []);
