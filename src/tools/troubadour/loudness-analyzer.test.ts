import { describe, expect, it } from 'vitest';
import {
  analyzeAudioBufferLoudness,
  computeIntegratedLoudness,
  loudnessFromEnergy,
  replayGainForLoudness
} from './loudness-analyzer';

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

  it('analyzes an already decoded audio buffer', () => {
    const samples = new Float32Array(48_000).fill(0.25);
    const buffer = {
      length: samples.length,
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 48_000,
      getChannelData: () => samples
    } as unknown as AudioBuffer;
    const analysis = analyzeAudioBufferLoudness(buffer);

    expect(analysis.duration).toBe(1);
    expect(analysis.channels).toBe(1);
    expect(analysis.samplePeak).toBeCloseTo(0.25);
    expect(analysis.integratedLufs).toBeTypeOf('number');
  });
});
