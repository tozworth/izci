import { describe, expect, it } from 'vitest';
import { computeIntegratedLoudness, loudnessFromEnergy, replayGainForLoudness } from './loudness-analyzer';

describe('loudness gating', () => {
  it('rejects silence', () => {
    expect(computeIntegratedLoudness([0, 0])).toBe(Number.NEGATIVE_INFINITY);
  });

  it('applies the relative gate to quiet blocks', () => {
    const loud = 0.1;
    const quiet = 0.00001;
    expect(computeIntegratedLoudness([loud, loud, quiet])).toBeCloseTo(loudnessFromEnergy(loud), 8);
  });

  it('converts integrated loudness to ReplayGain', () => {
    expect(replayGainForLoudness(-14.25, -18)).toBeCloseTo(-3.75);
  });
});
