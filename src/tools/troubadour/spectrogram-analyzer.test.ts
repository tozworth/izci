import { describe, expect, it } from 'vitest';
import { computeWindowSpectrum } from './spectrogram-analyzer';

describe('spectrogram FFT', () => {
  it('places a bin-centered full-scale sine at the expected frequency', () => {
    const size = 4096;
    const expectedBin = 320;
    const samples = Float32Array.from(
      { length: size },
      (_, index) => Math.sin((2 * Math.PI * expectedBin * index) / size)
    );
    const spectrum = computeWindowSpectrum(samples);
    let peakBin = 0;
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      if (spectrum[bin] > spectrum[peakBin]) peakBin = bin;
    }
    expect(peakBin).toBe(expectedBin);
    expect(spectrum[peakBin]).toBeCloseTo(0, 2);
    expect(spectrum[expectedBin * 2]).toBeLessThan(-100);
  });

  it('uses a finite noise floor for silence', () => {
    const spectrum = computeWindowSpectrum(new Float32Array(2048));
    expect(spectrum.every((value) => value === -160)).toBe(true);
  });

  it('rejects non-power-of-two windows', () => {
    expect(() => computeWindowSpectrum(new Float32Array(1000))).toThrow(/power of two/i);
  });
});
