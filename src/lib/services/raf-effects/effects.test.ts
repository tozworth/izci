import { describe, expect, it } from 'vitest';
import {
  CRYSTALIZER_FREQUENCIES,
  createCrystalizerNode,
  intensityToFactor,
  updateCrystalizerNode
} from './crystalizer';
import { GRAPHIC_EQ_FREQUENCIES, GRAPHIC_EQ_Q, createGraphicEqNode, updateGraphicEqNode } from './graphic-eq';
import { createStereoWidthNode, stereoWidthToMidSideGains, updateStereoWidthNode } from './mid-side';
import {
  createSafeLimiterCurve,
  createSloptimizerNode,
  mapSlopToParameters,
  sloptimizerIsTransparent,
  updateSloptimizerNode
} from './sloptimizer';

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
  getFrequencyResponse(_frequencies: Float32Array, magnitudes: Float32Array, phases?: Float32Array): void {
    magnitudes.fill(10 ** (this.gain.value / 20));
    phases?.fill(0);
  }
}
class FakeIir extends FakeNode {}
class FakeDelay extends FakeNode { delayTime = new FakeParam(); }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}
class FakeWaveShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
}

class FakeContext {
  currentTime = 1;
  sampleRate = 48_000;
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  splitters: FakeNode[] = [];
  mergers: FakeNode[] = [];
  iirs: FakeIir[] = [];
  delays: FakeDelay[] = [];
  compressors: FakeCompressor[] = [];
  waveShapers: FakeWaveShaper[] = [];
  createGain(): GainNode { const node = new FakeGain(); this.gains.push(node); return node as unknown as GainNode; }
  createBiquadFilter(): BiquadFilterNode { const node = new FakeFilter(); this.filters.push(node); return node as unknown as BiquadFilterNode; }
  createChannelSplitter(): ChannelSplitterNode { const node = new FakeNode(); this.splitters.push(node); return node as unknown as ChannelSplitterNode; }
  createChannelMerger(): ChannelMergerNode { const node = new FakeNode(); this.mergers.push(node); return node as unknown as ChannelMergerNode; }
  createIIRFilter(): IIRFilterNode { const node = new FakeIir(); this.iirs.push(node); return node as unknown as IIRFilterNode; }
  createDelay(): DelayNode { const node = new FakeDelay(); this.delays.push(node); return node as unknown as DelayNode; }
  createDynamicsCompressor(): DynamicsCompressorNode { const node = new FakeCompressor(); this.compressors.push(node); return node as unknown as DynamicsCompressorNode; }
  createWaveShaper(): WaveShaperNode { const node = new FakeWaveShaper(); this.waveShapers.push(node); return node as unknown as WaveShaperNode; }
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

describe('Crystalizer DSP', () => {
  it('builds thirteen transient bands, stays transparent at zero, and adds response-derived headroom', () => {
    const context = new FakeContext();
    const settings = {
      id: 'crystalizer',
      type: 'crystalizer' as const,
      enabled: true,
      bandIntensities: CRYSTALIZER_FREQUENCIES.map(() => 0),
      bandMuted: CRYSTALIZER_FREQUENCIES.map(() => false),
      bandBypassed: CRYSTALIZER_FREQUENCIES.map(() => false)
    };
    const node = createCrystalizerNode(context as unknown as BaseAudioContext, settings);
    expect(node.bands).toHaveLength(13);
    expect(context.iirs).toHaveLength(13);
    expect(context.delays).toHaveLength(14);
    expect(node.dryDelay.delayTime.value).toBe(1 / context.sampleRate);
    expect(node.headroom.gain.value).toBe(1);

    const bandIntensities = [...settings.bandIntensities];
    bandIntensities[12] = 32;
    updateCrystalizerNode(node, { ...settings, bandIntensities }, context as unknown as BaseAudioContext);
    expect((node.bands[12].intensity.gain as unknown as FakeParam).ramps.at(-1)).toBe(intensityToFactor(32));
    expect((node.headroom.gain as unknown as FakeParam).ramps.at(-1)).toBeLessThan(1);
  });
});

describe('Sloptimizer DSP', () => {
  it('maps the macro nonlinearly from transparent to aggressive settings', () => {
    const zero = mapSlopToParameters(0);
    const middle = mapSlopToParameters(50);
    const maximum = mapSlopToParameters(100);
    expect(zero).toMatchObject({ lowLiftDb: 0, midLiftDb: 0, highLiftDb: 0, density: 0, ceilingDb: 0 });
    expect(middle.density).toBeGreaterThan(50);
    expect(middle.lowLiftDb).toBeGreaterThan(middle.midLiftDb);
    expect(middle.highLiftDb).toBeGreaterThan(middle.lowLiftDb);
    expect(maximum).toMatchObject({ lowLiftDb: 8, midLiftDb: 4.5, highLiftDb: 11.5, density: 100, speed: 80, ceilingDb: -1 });
  });

  it('uses a dry path at zero and a bounded three-band maximizer when active', () => {
    const context = new FakeContext();
    const settings = {
      id: 'sloptimizer',
      type: 'sloptimizer' as const,
      enabled: true,
      advanced: false,
      slop: 0,
      customized: false,
      ...mapSlopToParameters(0)
    };
    const node = createSloptimizerNode(context as unknown as BaseAudioContext, settings);
    expect(node.bands).toHaveLength(3);
    expect(context.compressors).toHaveLength(4);
    expect(node.dry.gain.value).toBe(1);
    expect(node.processed.gain.value).toBe(0);
    expect(sloptimizerIsTransparent(settings)).toBe(true);

    const active = { ...settings, slop: 100, ...mapSlopToParameters(100) };
    updateSloptimizerNode(node, active, context as unknown as BaseAudioContext);
    expect((node.dry.gain as unknown as FakeParam).ramps.at(-1)).toBe(0);
    expect((node.processed.gain as unknown as FakeParam).ramps.at(-1)).toBe(1);
    expect((node.bands[2].lift.gain as unknown as FakeParam).ramps.at(-1)).toBeCloseTo(10 ** (11.5 / 20));
    expect(Math.max(...(node.saturator.curve ?? []))).toBeLessThanOrEqual(10 ** (-1 / 20));
  });

  it('keeps limiter curves monotonic, symmetric, and beneath their ceiling', () => {
    const curve = createSafeLimiterCurve(-1);
    const ceiling = 10 ** (-1 / 20);
    expect(curve[0]).toBeCloseTo(-ceiling);
    expect(curve.at(-1)).toBeCloseTo(ceiling);
    expect(curve[Math.floor(curve.length / 2)]).toBeCloseTo(0);
    expect(Array.from(curve).every((value, index) => index === 0 || value >= curve[index - 1])).toBe(true);
  });
});
