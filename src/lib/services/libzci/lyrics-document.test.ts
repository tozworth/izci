import { describe, expect, it } from 'vitest';
import {
  activeCueRange,
  validateLyricsDocument,
  type CoreLyricsDocument
} from './lyrics-document';

const document: CoreLyricsDocument = {
  raw: '[00:01.15] hello',
  plain: 'hello',
  lines: [
    { time_ms: 1150, text: 'hello' },
    { time_ms: 1150, text: 'world' },
    { time_ms: 2500, text: 'next' }
  ],
  offset_ms: 0
};

describe('core lyrics document boundary', () => {
  it('validates documents', () => {
    expect(() => validateLyricsDocument(document)).not.toThrow();
    expect(() => validateLyricsDocument({ ...document, offset_ms: 86_400_001 })).toThrow();
    expect(() => validateLyricsDocument({ ...document, raw: 'x'.repeat(256 * 1024 + 1) })).toThrow();
  });

  it('mirrors core active cue grouping', () => {
    expect(activeCueRange(document, 1.149)).toBeNull();
    expect(activeCueRange(document, 1.15)).toEqual({ start: 0, end: 2 });
    expect(activeCueRange(document, 2.5)).toEqual({ start: 2, end: 3 });
    expect(activeCueRange(document, Number.NaN)).toBeNull();
    expect(activeCueRange(document, -1)).toBeNull();
  });
});
