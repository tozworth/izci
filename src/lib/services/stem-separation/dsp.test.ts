import { describe, expect, it } from 'vitest';
import { calculatePeakTable, createHannWindow, encodeStereoWav } from './dsp';

describe('stem separation DSP helpers', () => {
  it('builds the periodic Hann window used by the reference export', () => {
    const window = createHannWindow(8);
    expect(window[0]).toBe(0);
    expect(window[4]).toBe(1);
    expect(window[1]).toBeCloseTo(window[7]);
  });

  it('encodes a valid float32 stereo WAV asset without clipping stem peaks', () => {
    const wav = encodeStereoWav(new Float32Array([0, 1]), new Float32Array([0, -1]));
    const bytes = new Uint8Array(wav);
    const view = new DataView(wav);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(34, true)).toBe(32);
    expect(view.getUint32(40, true)).toBe(16);
  });

  it('attenuates only mixes that need headroom', () => {
    const original = new Float32Array([1]);
    const vocal = new Float32Array([-0.8]);
    const table = calculatePeakTable(original, original, vocal, vocal);
    expect(table.find((point) => point.mix === 0)?.gain).toBe(1);
    expect(table.find((point) => point.mix === -1)?.gain).toBeLessThan(1);
  });
});
