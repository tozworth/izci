import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampAutoGain } from '$lib/services/raf-effects/auto-amp';
import { RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
import { blendRenderedEdges, createSpeedEffectSettings, renderClipEffect } from './clip-effects';
import { TestAudioBuffer, testAudioBuffer } from './test-audio-buffer';

afterEach(() => vi.unstubAllGlobals());

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

describe('responsive selection effects', () => {
  it('renders offline Auto Amp without changing its source', async () => {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
    const source = testAudioBuffer([[0.1, -0.25, 0.5], [-0.5, 0.25, -0.1]], 1000);
    const settings = RAF_EFFECT_REGISTRY['auto-amp'].createDefault('test');
    if (settings.type !== 'auto-amp') throw new Error('Expected Auto Amp');
    const result = await renderClipEffect(source, { ...settings, mode: 'off', gainDb: 6 });
    expect(result.getChannelData(0)[2]).toBeCloseTo(0.5 * 10 ** (6 / 20));
    expect(result.getChannelData(1)[0]).toBeCloseTo(-0.5 * 10 ** (6 / 20));
    expect(source.getChannelData(0)[2]).toBe(0.5);
  });

  it('preserves stereo amplitude and expected lengths for speed, tempo and pitch', async () => {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
    const source = testAudioBuffer([new Array(4096).fill(0.5), new Array(4096).fill(-0.25)], 1000);
    const reads = vi.spyOn(source, 'getChannelData');
    for (const mode of ['speed', 'tempo', 'pitch'] as const) {
      reads.mockClear();
      const result = await renderClipEffect(source, { ...createSpeedEffectSettings(), mode, factor: 2 });
      expect(result.length).toBe(mode === 'pitch' ? source.length : source.length / 2);
      for (const sample of result.getChannelData(0)) expect(sample).toBeCloseTo(0.5, 5);
      for (const sample of result.getChannelData(1)) expect(sample).toBeCloseTo(-0.25, 5);
      // The old overlap-add loop fetched channel arrays for each individual sample.
      expect(reads.mock.calls.length).toBeLessThan(10);
    }
  });

  it('keeps identity-speed output separate when edge blending mutates the rendered selection', async () => {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
    const original = testAudioBuffer([[0, 0, 0, 0, 0, 0]], 1000);
    const processed = await renderClipEffect(original, createSpeedEffectSettings());
    expect(processed).not.toBe(original);
    processed.getChannelData(0).fill(1);
    expect([...blendRenderedEdges(original, processed, 2).getChannelData(0)]).toEqual([0.5, 1, 1, 1, 1, 0.5]);
    expect([...original.getChannelData(0)]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('allows cancellation before allocating selection output', async () => {
    const allocation = vi.fn();
    vi.stubGlobal('AudioBuffer', allocation);
    const controller = new AbortController();
    const pending = renderClipEffect(testAudioBuffer([[1, 2, 3]]), createSpeedEffectSettings(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(allocation).not.toHaveBeenCalled();
  });
});
