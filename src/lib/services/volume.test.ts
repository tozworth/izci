import { describe, expect, it } from 'vitest';

import { applyReplayGain, decibelsToGain, sliderVolumeToGain } from './volume';

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

describe('applyReplayGain', () => {
  it('applies selected ReplayGain values to the effective gain', () => {
    expect(applyReplayGain(0.5, { trackGainDb: -6 }, 'track')).toBeCloseTo(0.5 * decibelsToGain(-6));
    expect(applyReplayGain(0.5, { albumGainDb: -3, trackGainDb: -6 }, 'album')).toBeCloseTo(
      0.5 * decibelsToGain(-3)
    );
  });

  it('falls back between track and album gain and skips off mode', () => {
    expect(applyReplayGain(0.5, { albumGainDb: -3 }, 'track')).toBeCloseTo(0.5 * decibelsToGain(-3));
    expect(applyReplayGain(0.5, { trackGainDb: -6 }, 'album')).toBeCloseTo(0.5 * decibelsToGain(-6));
    expect(applyReplayGain(0.5, { trackGainDb: -6 }, 'off')).toBe(0.5);
  });

  it('prevents ReplayGain peak clipping within the browser volume ceiling', () => {
    expect(applyReplayGain(0.5, { trackGainDb: 6, trackPeak: 0.75 }, 'track')).toBeCloseTo(0.5 / 0.75);
    expect(applyReplayGain(0.5, { trackGainDb: 6, trackPeak: 2 }, 'track')).toBe(0.25);
  });
});
