import { describe, expect, it } from 'vitest';
import { FileRangeReader } from './stream-meta-io';

describe('buffered file ranges', () => {
  it('reads across separated ranges after consuming part of a prefetched window', async () => {
    const bytes = Uint8Array.from({ length: 24 }, (_, i) => i);
    const reader = new FileRangeReader([{ offset: 0, length: 8 }, { offset: 16, length: 8 }],
      async (offset, length) => bytes.slice(offset, offset + length));
    expect(await reader.read(3)).toEqual(new Uint8Array([0, 1, 2]));
    expect(await reader.read(10)).toEqual(new Uint8Array([3, 4, 5, 6, 7, 16, 17, 18, 19, 20]));
    expect(reader.remaining).toBe(3);
    expect(await reader.read(3)).toEqual(new Uint8Array([21, 22, 23]));
  });

  it('reads a length field split across Ogg pages after a buffered prefix', async () => {
    const bytes = new Uint8Array([9, 9, 9, 9, 1, 2, 99, 99, 3, 4, 5, 6]);
    const reader = new FileRangeReader([{ offset: 0, length: 6 }, { offset: 8, length: 4 }],
      async (offset, length) => bytes.slice(offset, offset + length));
    await reader.read(4);
    expect(await reader.readUint32LE()).toBe(0x04030201);
    expect(await reader.read(2)).toEqual(new Uint8Array([5, 6]));
  });
});
