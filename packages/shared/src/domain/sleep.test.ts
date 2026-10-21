import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import { SleepLogSchema, sleepLogIdFor } from './sleep.js';

const USER = '0192f1a0-0000-7000-8000-0000000000aa';

const night = (overrides: Record<string, unknown> = {}) => ({
  id: sleepLogIdFor(USER, '2026-10-20'),
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
  date: '2026-10-20',
  quality: 4,
  loggedAt: 1_760_000_000_000,
  ...overrides,
});

describe('SleepLog (§5: un toque, calidad 1-5)', () => {
  it('se sincroniza como LWW con una calidad de 1 a 5 y el día local de la noche', () => {
    expect(SYNC_ROW_SCHEMAS.sleepLog).toBe(SleepLogSchema);
    expect(SleepLogSchema.safeParse(night()).success).toBe(true);
    expect(SleepLogSchema.safeParse(night({ quality: 1 })).success).toBe(true);
    expect(SleepLogSchema.safeParse(night({ quality: 5 })).success).toBe(true);
    expect(SleepLogSchema.safeParse(night({ quality: 0 })).success).toBe(false);
    expect(SleepLogSchema.safeParse(night({ quality: 6 })).success).toBe(false);
    expect(SleepLogSchema.safeParse(night({ quality: 3.5 })).success).toBe(false);
    expect(SleepLogSchema.safeParse(night({ date: '2026-13-01' })).success).toBe(false);
    expect(SleepLogSchema.safeParse(night({ hours: 8 })).success).toBe(false); // §5: solo calidad
  });

  it('SYNC §1: una fila por noche y cuenta; el id no depende del dispositivo', () => {
    expect(sleepLogIdFor(USER, '2026-10-20')).toBe(sleepLogIdFor(USER, '2026-10-20'));
    expect(sleepLogIdFor(USER, '2026-10-21')).not.toBe(sleepLogIdFor(USER, '2026-10-20'));
    expect(sleepLogIdFor(newId(), '2026-10-20')).not.toBe(sleepLogIdFor(USER, '2026-10-20'));
  });
});
