import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { BACKUP_VERSION, parseBackup } from './backup.js';

const deck = {
  id: newId(),
  name: 'Carpo',
  description: null,
  pausedAt: null,
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
};
const backup = (overrides: Record<string, unknown> = {}) => ({
  format: 'estudio-backup',
  version: BACKUP_VERSION,
  exportedAt: 1_760_000_000_000,
  userId: newId(),
  entities: { deck: [deck] },
  ...overrides,
});

describe('respaldo de ella (QUALITY QA7, AG2)', () => {
  it('acepta un respaldo válido; las entidades que no trae llegan vacías', () => {
    const parsed = parseBackup(backup());
    if (!('backup' in parsed)) throw new Error('debía ser válido');
    expect(parsed.backup.entities.deck).toEqual([deck]);
    expect(parsed.backup.entities.reviewLog).toEqual([]);
    expect(parsed.backup.entities.mediaAsset).toEqual([]);
  });

  it('rechaza otro archivo, una fila dañada y un respaldo de una versión más nueva', () => {
    expect(parseBackup({ hola: 1 })).toEqual({ problem: 'invalid' });
    expect(parseBackup(backup({ format: 'otra-app' }))).toEqual({ problem: 'invalid' });
    expect(parseBackup(backup({ entities: { deck: [{ ...deck, name: '' }] } }))).toEqual({
      problem: 'invalid',
    });
    expect(parseBackup(backup({ userId: 'no-es-uuid' }))).toEqual({ problem: 'invalid' });
    expect(parseBackup(backup({ version: BACKUP_VERSION + 1, entities: 'forma desconocida' }))).toEqual({
      problem: 'newer',
    });
  });
});
