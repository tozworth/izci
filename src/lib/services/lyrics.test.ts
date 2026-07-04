import { describe, expect, it } from 'vitest';
import { findActiveLyricIndex, parseLrcLyrics, stripLrcTimestamps } from './lyrics';

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
});
