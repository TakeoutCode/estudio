// FNV-1a de 32 bits con el mezclado final de MurmurHash3: un número en [0, 1) que depende
// solo del texto. Sirve de "sorteo" con semilla sin azar propio (AGENTS AG3); no son
// umbrales de estudio.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32 = 0x1_0000_0000;

export function unitHash(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / UINT32;
}
