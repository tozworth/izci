import { describe, expect, it } from 'vitest';
import { createHivelyPatternSong, type HivelyPatternData } from './hively-patterns';

describe('Hively pattern presentation', () => {
  it('builds and deduplicates transposed position patterns', () => {
    const data: HivelyPatternData = {
      channelCount: 2,
      instrumentNames: ['Lead', 'Bass'],
      positionCount: 2,
      positionTracks: new Uint8Array([0, 1, 0, 1]),
      positionTransposes: new Int8Array([0, 12, 0, 12]),
      steps: new Uint8Array([
        1, 1, 0xf, 0x03,
        0, 0, 0, 0,
        13, 2, 0, 0,
        0, 0, 0, 0
      ]),
      subsongCount: 3,
      trackCount: 2,
      trackLength: 2
    };

    const song = createHivelyPatternSong(data);

    expect(song.orders).toEqual([
      { name: 'Position 0', pat: 0 },
      { name: 'Position 1', pat: 0 }
    ]);
    expect(song.patterns).toHaveLength(1);
    expect(song.patterns[0]?.rows).toEqual([
      ['C-1 01    F03', 'C-3 02    ...'],
      ['... ..    ...', '... ..    ...']
    ]);
    expect(song.instruments).toEqual(['Lead', 'Bass']);
    expect(song.numSubsongs).toBe(3);
  });

  it('keeps differently transposed layouts as separate display patterns', () => {
    const data: HivelyPatternData = {
      channelCount: 1,
      instrumentNames: [],
      positionCount: 2,
      positionTracks: new Uint8Array([0, 0]),
      positionTransposes: new Int8Array([0, -12]),
      steps: new Uint8Array([25, 0, 0, 0]),
      subsongCount: 1,
      trackCount: 1,
      trackLength: 1
    };

    const song = createHivelyPatternSong(data);

    expect(song.patterns.map((pattern) => pattern.rows[0]?.[0])).toEqual([
      'C-3 ..    ...',
      'C-2 ..    ...'
    ]);
    expect(song.orders.map((order) => order.pat)).toEqual([0, 1]);
  });
});
