import { describe, expect, it } from 'vitest';
import { GRAPHIC_EQ_FREQUENCIES, GRAPHIC_EQ_Q, createGraphicEqNode, updateGraphicEqNode } from './graphic-eq';
import { createStereoWidthNode, stereoWidthToMidSideGains, updateStereoWidthNode } from './mid-side';

class FakeParam {
  value = 0;
  ramps: number[] = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void { this.value = value; }
  linearRampToValueAtTime(value: number): void { this.value = value; this.ramps.push(value); }
}

class FakeNode {
  connections: Array<{ destination: FakeNode; output?: number; input?: number }> = [];
  connect(destination: FakeNode, output?: number, input?: number): FakeNode {
    this.connections.push({ destination, output, input });
    return destination;
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
  getFrequencyResponse(_frequencies: Float32Array, magnitudes: Float32Array): void {
    magnitudes.fill(10 ** (this.gain.value / 20));
  }
}

class FakeContext {
  currentTime = 1;
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  splitters: FakeNode[] = [];
  mergers: FakeNode[] = [];
  createGain(): GainNode { const node = new FakeGain(); this.gains.push(node); return node as unknown as GainNode; }
  createBiquadFilter(): BiquadFilterNode { const node = new FakeFilter(); this.filters.push(node); return node as unknown as BiquadFilterNode; }
  createChannelSplitter(): ChannelSplitterNode { const node = new FakeNode(); this.splitters.push(node); return node as unknown as ChannelSplitterNode; }
  createChannelMerger(): ChannelMergerNode { const node = new FakeNode(); this.mergers.push(node); return node as unknown as ChannelMergerNode; }
}

describe('Graphic EQ DSP', () => {
  it('builds a preamp followed by ten octave-spaced peaking filters and ramps updates', () => {
    const context = new FakeContext();
    const settings = { id: 'eq', type: 'graphic-eq' as const, enabled: true, preampDb: 0, bandGainsDb: GRAPHIC_EQ_FREQUENCIES.map(() => 0) };
    const node = createGraphicEqNode(context as unknown as BaseAudioContext, settings);
    expect(context.filters.slice(0, 10).map((filter) => filter.frequency.value)).toEqual([...GRAPHIC_EQ_FREQUENCIES]);
    expect(context.filters.every((filter) => filter.type === 'peaking' && filter.Q.value === GRAPHIC_EQ_Q)).toBe(true);
    updateGraphicEqNode(node, { ...settings, preampDb: 6, bandGainsDb: settings.bandGainsDb.map((_, index) => index) }, context as unknown as BaseAudioContext);
    expect((node.preamp.gain as unknown as FakeParam).ramps.at(-1)).toBeCloseTo(10 ** (6 / 20));
    expect((node.filters[9].gain as unknown as FakeParam).ramps.at(-1)).toBe(9);
    expect((node.headroom.gain as unknown as FakeParam).ramps.at(-1)).toBeLessThan(1);
  });
});

describe('Stereo Width DSP', () => {
  it('uses a normalized matrix and attenuation-only width gains', () => {
    const context = new FakeContext();
    const settings = { id: 'width', type: 'stereo-width' as const, enabled: true, widthDb: 0 };
    const node = createStereoWidthNode(context as unknown as BaseAudioContext, settings);
    const coefficients = context.gains.map((gain) => gain.gain.value);
    expect(coefficients.filter((gain) => gain === Math.SQRT1_2)).toHaveLength(6);
    expect(coefficients.filter((gain) => gain === -Math.SQRT1_2)).toHaveLength(2);
    expect(node.midGain.gain.value).toBe(1);
    expect(node.sideGain.gain.value).toBe(1);
    updateStereoWidthNode(node, { ...settings, widthDb: 12 }, context as unknown as BaseAudioContext);
    expect((node.midGain.gain as unknown as FakeParam).ramps.at(-1)).toBeCloseTo(10 ** (-12 / 20));
    expect((node.sideGain.gain as unknown as FakeParam).ramps.at(-1)).toBe(1);
    expect(stereoWidthToMidSideGains(-12)).toEqual({ mid: 1, side: 10 ** (-12 / 20) });
  });
});
