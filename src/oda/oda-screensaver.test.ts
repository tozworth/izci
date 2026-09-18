import { describe, expect, it } from 'vitest';
import { randomScreensaverOffset, shuffleScreensaverItems } from './oda-screensaver';

describe('Oda screensaver helpers', () => {
  it('shuffles without dropping or duplicating entries', () => {
    const result = shuffleScreensaverItems(['a', 'b', 'c', 'd'], () => 0.2);
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('avoids immediately repeating the prior image when possible', () => {
    expect(shuffleScreensaverItems(['a', 'b', 'c'], () => 0.999, 'a')[0]).not.toBe('a');
  });

  it('returns a stable percentage precision for text placement', () => {
    expect(randomScreensaverOffset(() => 0.12345)).toBe(12.3);
  });
});
