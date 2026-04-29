import { describe, expect, it } from 'vitest';

import { sliderVolumeToGain } from './volume';

describe('sliderVolumeToGain', () => {
  it('uses linear gain when logarithmic volume is disabled', () => {
    expect(sliderVolumeToGain(0.25, false)).toBe(0.25);
    expect(sliderVolumeToGain(-1, false)).toBe(0);
    expect(sliderVolumeToGain(2, false)).toBe(1);
  });

  it('maps logarithmic slider values to a -60 dB curve', () => {
    expect(sliderVolumeToGain(0, true)).toBe(0);
    expect(sliderVolumeToGain(1, true)).toBe(1);
    expect(sliderVolumeToGain(0.5, true)).toBeCloseTo(0.0316227766);
  });
});
