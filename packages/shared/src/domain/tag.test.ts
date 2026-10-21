import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { encodeHlc } from '../sync/hlc.js';
import { SYNC_ROW_SCHEMAS } from '../sync/row-schemas.js';
import { NoteSchema } from './note.js';
import { TAG_NAME_MAX_LENGTH, TAGS_PER_NOTE_MAX, tagKey, TagSchema } from './tag.js';

const meta = () => ({
  id: newId(),
  hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
  updatedAt: 1_760_000_000_000,
  deletedAt: null,
});

const note = (extra: Record<string, unknown> = {}) => ({
  ...meta(),
  deckId: newId(),
  topicId: null,
  content: { kind: 'basic', front: '¿C1?', back: 'Atlas', explanation: '', reverse: false },
  origin: 'manual',
  ...extra,
});

describe('Tag (diseño: etiquetas de ella, entre mazos)', () => {
  it('se sincroniza como LWW con un nombre', () => {
    expect(SYNC_ROW_SCHEMAS.tag).toBe(TagSchema);
    expect(TagSchema.parse({ ...meta(), name: '  Miembro superior ' }).name).toBe('Miembro superior');
    expect(TagSchema.safeParse({ ...meta(), name: ' ' }).success).toBe(false);
    expect(TagSchema.safeParse({ ...meta(), name: 'a'.repeat(TAG_NAME_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it('mayúsculas, acentos y espacios no hacen otra etiqueta', () => {
    expect(tagKey('  Músculos   del HOMBRO ')).toBe(tagKey('musculos del hombro'));
    expect(tagKey('Parcial 1')).not.toBe(tagKey('Parcial 2'));
  });

  it('la nota guarda sus etiquetas sin repetir; una nota del contrato 12 llega sin ellas', () => {
    const [a, b] = [newId(), newId()];
    expect(NoteSchema.parse(note({ tagIds: [a, b] })).tagIds).toEqual([a, b]);
    expect(NoteSchema.parse(note()).tagIds).toEqual([]);
    expect(NoteSchema.safeParse(note({ tagIds: [a, a] })).success).toBe(false);
    const many = Array.from({ length: TAGS_PER_NOTE_MAX + 1 }, () => newId());
    expect(NoteSchema.safeParse(note({ tagIds: many })).success).toBe(false);
  });
});
