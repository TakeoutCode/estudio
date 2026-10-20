import { compareHlc, decodeHlc } from '@estudio/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceId, nextHlc } from './clock';
import { EstudioDb } from './schema';

const open: EstudioDb[] = [];
const freshDb = () => {
  const database = new EstudioDb(`clock-${crypto.randomUUID()}`);
  open.push(database);
  return database;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((database) => database.delete()));
});

describe('reloj del dispositivo (SYNC SY2)', () => {
  it('el deviceId se genera una vez y se conserva', async () => {
    const database = freshDb();
    const first = await deviceId(database);
    expect(await deviceId(database)).toBe(first);
  });

  it('nextHlc avanza aunque el reloj del dispositivo retroceda, y usa el deviceId como nodo', async () => {
    const database = freshDb();
    const a = await nextHlc(database, 2_000);
    const b = await nextHlc(database, 1_000);
    const c = await nextHlc(database, 3_000);
    expect(compareHlc(b, a)).toBeGreaterThan(0);
    expect(compareHlc(c, b)).toBeGreaterThan(0);
    expect(decodeHlc(c).node).toBe(await deviceId(database));
  });

  it('el HLC sobrevive a reabrir la base', async () => {
    const database = freshDb();
    const before = await nextHlc(database, 5_000);
    database.close();
    await database.open();
    expect(compareHlc(await nextHlc(database, 1), before)).toBeGreaterThan(0);
  });
});
