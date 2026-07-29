import { describe, expect, it } from 'vitest';
import { parseHivelyMetadata } from '$lib/services/module-metadata';

function ahxBuffer(title = 'Karma'): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set([0x54, 0x48, 0x58, 0x01]);
  bytes[5] = 16;
  bytes[6] = 0;
  bytes[7] = 12;
  bytes[12] = 7;
  bytes[13] = 2;
  bytes.set(new TextEncoder().encode(`${title}\0`), 16);
  return bytes.buffer;
}

function hvlBuffer(title = 'Chiprolled'): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set([0x48, 0x56, 0x4c, 0x01]);
  bytes[5] = 16;
  bytes[7] = 20;
  bytes[8] = 8;
  bytes[12] = 9;
  bytes[13] = 1;
  bytes.set(new TextEncoder().encode(`${title}\0`), 16);
  return bytes.buffer;
}

describe('Hively metadata parsing', () => {
  it('reads the header metadata without invoking libopenmpt', () => {
    expect(parseHivelyMetadata(ahxBuffer())).toEqual({
      title: 'Karma',
      trackerType: "Abyss' Highest eXperience",
      originalType: 'ahx',
      channels: 4,
      instruments: 7,
      orders: 12,
      subsongs: 3
    });

    expect(parseHivelyMetadata(hvlBuffer())).toEqual({
      title: 'Chiprolled',
      trackerType: 'HivelyTracker',
      originalType: 'hvl',
      channels: 6,
      instruments: 9,
      orders: 20,
      subsongs: 2
    });
  });

  it('rejects non-Hively and unsupported-version headers', () => {
    expect(parseHivelyMetadata(new Uint8Array(16).buffer)).toBeNull();
    const unsupported = new Uint8Array(ahxBuffer());
    unsupported[3] = 3;
    expect(parseHivelyMetadata(unsupported.buffer)).toBeNull();
  });
});
