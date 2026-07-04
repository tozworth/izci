import { describe, expect, it } from 'vitest';
import {
  buildTheaterLyricRows,
  findActiveLyricIndex,
  findActiveTimelineIndex,
  hasRenderableLyrics,
  parseLrcLyrics,
  stripLrcTimestamps
} from './lyrics';

describe('lyrics helpers', () => {
  it('parses LRC timestamps and sorts repeated timestamp lines', () => {
    const lines = parseLrcLyrics('[00:05.25] Five\n[00:01.5][00:03.050] Shared\n[00:07] Seven');

    expect(lines).toEqual([
      { time: 1.5, text: 'Shared' },
      { time: 3.05, text: 'Shared' },
      { time: 5.25, text: 'Five' },
      { time: 7, text: 'Seven' }
    ]);
  });

  it('finds the active line at and after its timestamp', () => {
    const lines = parseLrcLyrics('[00:01.00] One\n[00:02.00] Two\n[00:04.00] Four');

    expect(findActiveLyricIndex(lines, 0.5)).toBe(-1);
    expect(findActiveLyricIndex(lines, 1)).toBe(0);
    expect(findActiveLyricIndex(lines, 3.5)).toBe(1);
    expect(findActiveLyricIndex(lines, 4.5)).toBe(2);
  });

  it('strips timestamps for plain text rendering', () => {
    expect(stripLrcTimestamps('[00:01.00] One\n[00:02.50] Two')).toBe('One\nTwo');
  });

  it('ignores empty timestamp rows', () => {
    expect(parseLrcLyrics('[00:01.00]\n[00:02.00] Two')).toEqual([{ time: 2, text: 'Two' }]);
  });

  it('treats a single untimestamped line as no renderable lyrics', () => {
    expect(hasRenderableLyrics('[Instrumental]')).toBe(false);
    expect(hasRenderableLyrics('One line only')).toBe(false);
    expect(hasRenderableLyrics('First line\nSecond line')).toBe(true);
    expect(hasRenderableLyrics('[00:12.00] Timed line')).toBe(true);
  });

  it('does not add theater downtime rows for short gaps with the default threshold', () => {
    const rows = buildTheaterLyricRows(
      parseLrcLyrics(
        "[00:00.00] I just wonder what we've gotten ourselves into\n[00:05.76] In a trail of fire, I know we will be free again"
      ),
      60
    );

    expect(rows.map((row) => row.type)).toEqual(['lyric', 'lyric', 'downtime']);
  });

  it('adds theater downtime rows for long gaps and track starts', () => {
    const rows = buildTheaterLyricRows(
      parseLrcLyrics('[00:08.00] First\n[00:20.00] Second'),
      30,
      true,
      5
    );

    expect(rows.map((row) => row.type)).toEqual([
      'downtime',
      'lyric',
      'downtime',
      'lyric',
      'downtime'
    ]);
    expect(findActiveTimelineIndex(rows, 0)).toBe(0);
    expect(findActiveTimelineIndex(rows, 8)).toBe(1);
    expect(findActiveTimelineIndex(rows, 13.1)).toBe(2);
    expect(findActiveTimelineIndex(rows, 20)).toBe(3);
    expect(findActiveTimelineIndex(rows, 25.1)).toBe(4);
  });
});
