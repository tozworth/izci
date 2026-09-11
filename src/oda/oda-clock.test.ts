import { describe, expect, it } from 'vitest';
import { formatOdaClockText } from './oda-clock';

describe('formatOdaClockText', () => {
  it('returns short date and time as separate parts', () => {
    // Constructed from local components so the expectation holds in any timezone.
    const now = new Date(2026, 8, 11, 21, 45);
    expect(formatOdaClockText(now, 'en-US')).toEqual({
      date: 'Fri, Sep 11',
      time: '9:45 PM'
    });
  });

  it('falls back to English for an empty locale', () => {
    const now = new Date(2026, 8, 11, 9, 5);
    expect(formatOdaClockText(now, '').time).toContain('9:05');
  });
});
