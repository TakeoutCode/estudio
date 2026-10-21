import { MutationSchema, sleepLogIdFor } from '@estudio/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { updateProfile, updateStudyConfig } from '@/features/settings';
import { logSleep } from './commands';
import { readSleepToday } from './queries';

const ME = '0192f1a0-0000-7000-8000-00000000c0de';
/** Martes 20 a las 09:00 en CDMX. */
const T0 = Date.UTC(2026, 9, 20, 15);
const MIN = 60_000;

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: ME });
});

describe('logSleep (§5: un toque, calidad 1-5)', () => {
  it('FE3: guarda la noche de hoy con su id determinista y la encola para sync', async () => {
    const row = await logSleep(4, { now: T0 });
    expect(row).toMatchObject({ id: sleepLogIdFor(ME, '2026-10-20'), date: '2026-10-20', quality: 4 });
    expect(await db.sleepLogs.toArray()).toEqual([row]);
    const [entry] = await db.outbox.toArray();
    expect(MutationSchema.parse(entry)).toMatchObject({ op: 'upsert', entity: 'sleepLog', row });
  });

  it('tocar otro número el mismo día corrige la misma fila; anota cuándo la registró por primera vez', async () => {
    const first = await logSleep(2, { now: T0 });
    const fixed = await logSleep(3, { now: T0 + 5 * MIN });
    expect(fixed.id).toBe(first.id);
    expect(fixed.loggedAt).toBe(T0);
    expect(fixed.hlc > first.hlc).toBe(true);
    expect(await db.sleepLogs.toArray()).toEqual([fixed]);
    expect(await db.outbox.count()).toBe(2);
  });

  it('AG6: el día es el de su zona, no el UTC', async () => {
    await updateProfile((p) => ({ ...p, timeZone: 'America/Mexico_City' }), 'America/Mexico_City');
    // 23:30 del martes en CDMX ya es miércoles en UTC.
    const late = Date.UTC(2026, 9, 21, 5, 30);
    expect((await logSleep(5, { now: late })).date).toBe('2026-10-20');
    await updateProfile((p) => ({ ...p, timeZone: 'Asia/Tokyo' }), 'Asia/Tokyo');
    expect((await logSleep(5, { now: late })).date).toBe('2026-10-21');
  });

  it('sin cuenta ligada no escribe nada', async () => {
    await db.meta.delete('accountUserId');
    await expect(logSleep(3, { now: T0 })).rejects.toThrow('no_account');
    expect(await db.sleepLogs.count()).toBe(0);
  });
});

describe('readSleepToday', () => {
  it('§5: apagado por defecto; activado, dice si ya anotó la noche de hoy', async () => {
    expect(await readSleepToday(db, T0)).toEqual({ enabled: false, today: null });
    await updateStudyConfig(
      (c) => ({ ...c, metrics: { ...c.metrics, visible: { ...c.metrics.visible, sleep: true } } }),
      {
        now: T0,
      },
    );
    expect(await readSleepToday(db, T0)).toEqual({ enabled: true, today: null });
    const row = await logSleep(4, { now: T0 });
    expect(await readSleepToday(db, T0)).toEqual({ enabled: true, today: row });
    expect(await readSleepToday(db, T0 + 24 * 60 * MIN)).toEqual({ enabled: true, today: null });
  });
});
