import { describe, expect, it } from 'vitest';
import {
  formatLyricsTimestamp,
  parseLyricsForEditor,
  parseLyricsTimestamp,
  remapLyricsToClip,
  serializeLyrics
} from './lyrics-editor';

describe('Clip and Tag lyrics editor helpers', () => {
  it('parses plain and multiply timestamped LRC lines', () => {
    expect(parseLyricsForEditor('[ar:Artist]\n[00:01.250][00:02.50]Hello\nPlain')).toEqual([
      { time: 1.25, text: 'Hello' },
      { time: 2.5, text: 'Hello' },
      { time: null, text: 'Plain' }
    ]);
  });

  it('round-trips millisecond timestamps', () => {
    expect(formatLyricsTimestamp(65.234)).toBe('01:05.234');
    expect(parseLyricsTimestamp('[1:05.234]')).toBe(65.234);
    expect(serializeLyrics([{ time: 65.234, text: 'Line' }])).toBe('[01:05.234]Line');
  });

  it('remaps timestamps through clip cuts', () => {
    const raw = '[0:01.000]One\n[0:04.000]Cut\n[0:06.500]Two';
    expect(remapLyricsToClip(raw, [{ start: 0, end: 2 }, { start: 5, end: 8 }])).toBe(
      '[00:01.000]One\n[00:03.500]Two'
    );
  });
});
