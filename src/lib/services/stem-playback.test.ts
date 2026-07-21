import { describe, expect, it } from 'vitest';
import { getStemMixGains, interpolateStemPeakGain } from './stem-playback';

describe('stem playback gain law', () => {
  it('keeps center identical and reaches both endpoints', () => {
    expect(getStemMixGains(-1)).toEqual({ original: 1, vocal: -1 });
    expect(getStemMixGains(0)).toEqual({ original: 1, vocal: 0 });
    expect(getStemMixGains(1)).toEqual({ original: 0, vocal: 1 });
    expect(getStemMixGains(-0.25)).toEqual({ original: 1, vocal: -0.25 });
    expect(getStemMixGains(0.25)).toEqual({ original: 0.75, vocal: 0.25 });
  });

  it('clamps invalid values and interpolates peak compensation', () => {
    expect(getStemMixGains(Number.NaN)).toEqual({ original: 1, vocal: 0 });
    expect(getStemMixGains(5)).toEqual({ original: 0, vocal: 1 });
    expect(
      interpolateStemPeakGain(
        [
          { mix: -1, gain: 0.8 },
          { mix: 0, gain: 1 },
          { mix: 1, gain: 0.9 }
        ],
        -0.5
      )
    ).toBeCloseTo(0.9);
  });
});
