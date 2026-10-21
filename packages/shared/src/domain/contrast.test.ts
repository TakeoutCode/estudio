import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import { CONTRAST_MEMBERS, ContrastGroupSchema } from './contrast.js';

const group = (overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
  name: 'Nervios craneales',
  noteIds: [newId(), newId(), newId()],
  abSeed: 123_456,
  abArm: 'contrast',
  ...overrides,
});

describe('ContrastGroup (R9, LD10)', () => {
  it('se sincroniza como LWW y guarda su brazo y la semilla del sorteo', () => {
    expect(SYNC_ROW_SCHEMAS.contrastGroup).toBe(ContrastGroupSchema);
    expect(ContrastGroupSchema.safeParse(group()).success).toBe(true);
    expect(ContrastGroupSchema.safeParse(group({ abArm: 'control' })).success).toBe(true);
    expect(ContrastGroupSchema.safeParse(group({ abArm: 'otro' })).success).toBe(false);
    expect(ContrastGroupSchema.safeParse(group({ abSeed: -1 })).success).toBe(false);
    expect(ContrastGroupSchema.safeParse(group({ abSeed: 2 ** 32 })).success).toBe(false);
  });

  it('necesita al menos 2 notas distintas, sin pasar del máximo, y un nombre', () => {
    const one = newId();
    expect(ContrastGroupSchema.safeParse(group({ noteIds: [one] })).success).toBe(false);
    expect(ContrastGroupSchema.safeParse(group({ noteIds: [one, one] })).success).toBe(false);
    const many = Array.from({ length: CONTRAST_MEMBERS.max + 1 }, () => newId());
    expect(ContrastGroupSchema.safeParse(group({ noteIds: many })).success).toBe(false);
    expect(ContrastGroupSchema.safeParse(group({ name: '  ' })).success).toBe(false);
  });
});
