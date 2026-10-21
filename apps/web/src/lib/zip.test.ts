import { describe, expect, it } from 'vitest';
import { crc32, createZip } from './zip';

/** Lector mínimo: recorre el directorio central como lo haría un descompresor. */
function readZip(zip: Uint8Array): { name: string; text: string; crcOk: boolean }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  return Array.from({ length: count }, () => {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength;
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = zip.subarray(start, start + size);
    return { name, text: decoder.decode(data), crcOk: crc32(data) === crc };
  });
}

describe('ZIP sin compresión (QUALITY QA7)', () => {
  it('CRC-32 estándar', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('guarda varios archivos con nombres UTF-8 y se pueden leer de vuelta', () => {
    const encoder = new TextEncoder();
    const zip = createZip(
      [
        { name: 'notes.csv', data: encoder.encode('id,front\n1,¿Qué hueso?\n') },
        { name: 'exámenes.csv', data: encoder.encode('') },
      ],
      new Date(2026, 9, 20, 15, 30, 10),
    );
    expect(readZip(zip)).toEqual([
      { name: 'notes.csv', text: 'id,front\n1,¿Qué hueso?\n', crcOk: true },
      { name: 'exámenes.csv', text: '', crcOk: true },
    ]);
  });
});
