import { describe, expect, it } from 'vitest';
import { shiftLyricsTimestamps, type EditableLyricLine } from './timestamped-lyrics';

describe('shiftLyricsTimestamps', () => {
  it('shifts every timed line in exact 0.1 second steps', () => {
    const lines: EditableLyricLine[] = [
      { time: 1.234, text: 'First' },
      { time: null, text: 'Untimed' },
      { time: 65.9, text: 'Last' }
    ];

    expect(shiftLyricsTimestamps(lines, 0.1)).toEqual([
      { time: 1.334, text: 'First' },
      { time: null, text: 'Untimed' },
      { time: 66, text: 'Last' }
    ]);
  });

  it('clamps timestamps at zero when shifting earlier', () => {
    expect(shiftLyricsTimestamps([
      { time: 0.05, text: 'First' },
      { time: 0.2, text: 'Second' }
    ], -0.1)).toEqual([
      { time: 0, text: 'First' },
      { time: 0.1, text: 'Second' }
    ]);
  });
});
