import { describe, expect, it } from 'vitest';
import { clampAutoGain } from '$lib/services/raf-effects/auto-amp';

describe('offline Auto Amp selection gain', () => {
  it('honors reduce-only and increase-only limits', () => {
    const base = { maximumReductionDb: 6, maximumBoostDb: 4 };
    expect(clampAutoGain(-12, { ...base, mode: 'reduce' })).toBe(-6);
    expect(clampAutoGain(9, { ...base, mode: 'reduce' })).toBe(0);
    expect(clampAutoGain(-9, { ...base, mode: 'increase' })).toBe(0);
    expect(clampAutoGain(9, { ...base, mode: 'increase' })).toBe(4);
    expect(clampAutoGain(-9, { ...base, mode: 'dynamic' })).toBe(-6);
    expect(clampAutoGain(9, { ...base, mode: 'dynamic' })).toBe(4);
  });
});
