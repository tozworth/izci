import { describe, expect, it } from 'vitest';
import {
  loadModuleMetadataFromFile,
  parseHivelyMetadata
} from '$lib/services/module-metadata';
import type { MediaEntity } from '$lib/contracts/catalog';

function ahxBuffer(title = 'Karma'): ArrayBuffer {
  const bytes = new Uint8Array(96);
  bytes.set([0x54, 0x48, 0x58, 0x01]);
  bytes[5] = 64;
  bytes[6] = 0;
  bytes[7] = 12;
  bytes[11] = 129;
  bytes[12] = 7;
  bytes[13] = 2;
  bytes.set(new TextEncoder().encode(`${title}\0Lead\0Bass\0\0Pads\0\0\0FX\0`), 64);
  return bytes.buffer;
}

function hvlBuffer(title = 'Chiprolled'): ArrayBuffer {
  const bytes = new Uint8Array(112);
  bytes.set([0x48, 0x56, 0x4c, 0x01]);
  bytes[5] = 64;
  bytes[7] = 20;
  bytes[8] = 8;
  bytes[11] = 24;
  bytes[12] = 9;
  bytes[13] = 1;
  bytes.set(new TextEncoder().encode(`${title}\0Lead\0Bass\0\0Pads\0\0\0FX\0\0\0`), 64);
  return bytes.buffer;
}

describe('Hively metadata parsing', () => {
  it('reads the header metadata without invoking libopenmpt', () => {
    expect(parseHivelyMetadata(ahxBuffer())).toEqual({
      title: 'Karma',
      trackerType: "Abyss' Highest eXperience",
      originalType: 'ahx',
      channels: 4,
      tracks: 129,
      instruments: 7,
      orders: 12,
      subsongs: 3,
      message: 'Lead\nBass\n\nPads\n\n\nFX'
    });

    expect(parseHivelyMetadata(hvlBuffer())).toEqual({
      title: 'Chiprolled',
      trackerType: 'HivelyTracker',
      originalType: 'hvl',
      channels: 6,
      tracks: 24,
      instruments: 9,
      orders: 20,
      subsongs: 2,
      message: 'Lead\nBass\n\nPads\n\n\nFX'
    });
  });

  it('rejects non-Hively and unsupported-version headers', () => {
    expect(parseHivelyMetadata(new Uint8Array(16).buffer)).toBeNull();
    const unsupported = new Uint8Array(ahxBuffer());
    unsupported[3] = 3;
    expect(parseHivelyMetadata(unsupported.buffer)).toBeNull();
  });

  it('reads Hively metadata from the pipeline-owned file without browser playback', async () => {
    const entity: MediaEntity = {
      id: 'hively',
      path: 'Modules/Karma.ahx',
      name: 'Karma.ahx',
      format: 'ahx',
      kind: 'module',
      size: 96,
      lastModified: 1
    };
    const file = new File([ahxBuffer()], entity.name);

    await expect(loadModuleMetadataFromFile(entity, file)).resolves.toMatchObject({
      title: 'Karma',
      trackerType: "Abyss' Highest eXperience"
    });
  });
});
