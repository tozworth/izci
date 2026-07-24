import { describe, expect, it } from 'vitest';
import {
  CRYSTALIZER_FREQUENCIES,
  createCrystalizerNode,
  intensityToFactor,
  updateCrystalizerNode
} from './crystalizer';
import { GRAPHIC_EQ_FREQUENCIES, GRAPHIC_EQ_Q, createGraphicEqNode, updateGraphicEqNode } from './graphic-eq';
import { createStereoWidthNode, stereoWidthToMidSideGains, updateStereoWidthNode } from './mid-side';
import { createReverbNode, createRoomImpulse, reverbMixToGains, updateReverbNode } from './reverb';
import {
  calculateUpwardBoostDb,
  createSafeLimiterCurve,
  createSloptimizerNode,
  mapSlopToParameters,
  SLOPTIMIZER_CROSSOVERS,
  sloptimizerIsTransparent,
  updateSloptimizerNode
} from './sloptimizer';
import { FakeAudioBuffer, FakeContext, FakeParam } from './test-audio-context';

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

  it('ramps only the EQ parameters that changed', () => {
    const context = new FakeContext();
    const settings = { id: 'eq', type: 'graphic-eq' as const, enabled: true, preampDb: 0, bandGainsDb: GRAPHIC_EQ_FREQUENCIES.map(() => 0) };
    const node = createGraphicEqNode(context as unknown as BaseAudioContext, settings);
    const bandGainsDb = [...settings.bandGainsDb];
    bandGainsDb[4] = -2.5;

    updateGraphicEqNode(node, { ...settings, bandGainsDb }, context as unknown as BaseAudioContext, settings);

    expect((node.preamp.gain as unknown as FakeParam).ramps).toHaveLength(0);
    expect((node.filters[4].gain as unknown as FakeParam).ramps).toEqual([-2.5]);
    expect(node.filters.every((filter, index) => index === 4 || (filter.gain as unknown as FakeParam).ramps.length === 0)).toBe(true);
    expect((node.headroom.gain as unknown as FakeParam).ramps).toHaveLength(1);
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

  it('ramps only the Crystalizer band that changed', () => {
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
    const bandIntensities = [...settings.bandIntensities];
    bandIntensities[3] = 16;

    updateCrystalizerNode(node, { ...settings, bandIntensities }, context as unknown as BaseAudioContext, settings);

    expect((node.bands[3].intensity.gain as unknown as FakeParam).ramps).toEqual([intensityToFactor(16)]);
    expect(node.bands.every((band, index) => index === 3 || (band.intensity.gain as unknown as FakeParam).ramps.length === 0)).toBe(true);
    expect(node.bands.every((band) => (band.mute.gain as unknown as FakeParam).ramps.length === 0)).toBe(true);
    expect((node.headroom.gain as unknown as FakeParam).ramps).toHaveLength(1);
  });
});

describe('Sloptimizer DSP', () => {
  it('maps the macro nonlinearly from transparent to aggressive settings', () => {
    const zero = mapSlopToParameters(0);
    const middle = mapSlopToParameters(50);
    const maximum = mapSlopToParameters(100);
    expect(zero).toMatchObject({
      lowLiftDb: 0,
      midLiftDb: 0,
      highLiftDb: 0,
      density: 0,
      upwardRatio: 1,
      upwardMaximumBoostDb: 0,
      ceilingDb: 0
    });
    expect(middle.density).toBeGreaterThan(50);
    expect(middle.lowLiftDb).toBeGreaterThan(middle.midLiftDb);
    expect(middle.highLiftDb).toBeGreaterThan(middle.lowLiftDb);
    expect(maximum).toMatchObject({
      lowLiftDb: 8,
      midLiftDb: 4.5,
      highLiftDb: 11.5,
      density: 100,
      speed: 80,
      upwardRatio: 4,
      upwardThresholdDb: -24,
      upwardMaximumBoostDb: 12,
      ceilingDb: -1
    });
  });

  it('boosts only the useful range below the upward threshold', () => {
    expect(calculateUpwardBoostDb(-18, -24, 4, 12)).toBe(0);
    expect(calculateUpwardBoostDb(-32, -24, 4, 12)).toBe(6);
    expect(calculateUpwardBoostDb(-60, -24, 4, 12)).toBe(12);
    expect(calculateUpwardBoostDb(-69, -24, 4, 12)).toBe(6);
    expect(calculateUpwardBoostDb(-72, -24, 4, 12)).toBe(0);
    expect(calculateUpwardBoostDb(-32, -24, 1, 12)).toBe(0);
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
      lowCrossoverHz: SLOPTIMIZER_CROSSOVERS[0],
      highCrossoverHz: SLOPTIMIZER_CROSSOVERS[1],
      ...mapSlopToParameters(0)
    };
    const node = createSloptimizerNode(context as unknown as BaseAudioContext, settings);
    expect(node.bands).toHaveLength(3);
    expect(context.compressors).toHaveLength(4);
    expect(node.bands.map((band) => band.filters.map((filter) => filter.frequency.value))).toEqual([
      [180, 180],
      [180, 180, 3000, 3000],
      [3000, 3000]
    ]);
    expect(node.dry.gain.value).toBe(1);
    expect(node.processed.gain.value).toBe(0);
    expect(sloptimizerIsTransparent(settings)).toBe(true);

    const active = { ...settings, slop: 100, ...mapSlopToParameters(100) };
    updateSloptimizerNode(node, active, context as unknown as BaseAudioContext, settings);
    expect((node.dry.gain as unknown as FakeParam).ramps.at(-1)).toBe(0);
    expect((node.processed.gain as unknown as FakeParam).ramps.at(-1)).toBe(1);
    expect((node.bands[2].lift.gain as unknown as FakeParam).ramps.at(-1)).toBeCloseTo(10 ** (11.5 / 20));
    expect(Math.max(...(node.saturator.curve ?? []))).toBeLessThanOrEqual(10 ** (-1 / 20));

    const focusedBass = { ...active, lowCrossoverHz: 120 };
    updateSloptimizerNode(node, focusedBass, context as unknown as BaseAudioContext, active);
    expect(node.bands.map((band) => band.filters.map((filter) => (filter.frequency as unknown as FakeParam).ramps))).toEqual([
      [[120], [120]],
      [[120], [120], [], []],
      [[], []]
    ]);
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

describe('Reverb DSP', () => {
  it('builds a deterministic stereo room impulse with a decaying tail', () => {
    const firstContext = new FakeContext();
    const secondContext = new FakeContext();
    const first = createRoomImpulse(firstContext as unknown as BaseAudioContext, 55, 2.2) as unknown as FakeAudioBuffer;
    const second = createRoomImpulse(secondContext as unknown as BaseAudioContext, 55, 2.2) as unknown as FakeAudioBuffer;

    expect(first.numberOfChannels).toBe(2);
    expect(first.length).toBe(Math.ceil(2.2 * firstContext.sampleRate));
    expect(first.channels[0]).toEqual(second.channels[0]);
    expect(first.channels[0]).not.toEqual(first.channels[1]);
    expect(first.channels[0].some((sample) => sample !== 0)).toBe(true);
  });

  it('uses equal-power mix and crossfades impulse changes', () => {
    const context = new FakeContext();
    const settings = {
      id: 'reverb',
      type: 'reverb' as const,
      enabled: true,
      mix: 18,
      roomSize: 55,
      decaySeconds: 2.2,
      preDelayMs: 18,
      dampingHz: 9_000
    };
    const node = createReverbNode(context as unknown as BaseAudioContext, settings);
    expect(context.convolvers).toHaveLength(2);
    expect(node.slots[0].gain.gain.value).toBe(1);
    expect(node.slots[1].gain.gain.value).toBe(0);
    expect(reverbMixToGains(50).dry).toBeCloseTo(Math.SQRT1_2);
    expect(reverbMixToGains(50).wet).toBeCloseTo(Math.SQRT1_2);

    updateReverbNode(node, { ...settings, roomSize: 80, mix: 30 }, context as unknown as BaseAudioContext, settings);
    expect(node.activeSlot).toBe(1);
    expect((node.slots[0].gain.gain as unknown as FakeParam).ramps.at(-1)).toBe(0);
    expect((node.slots[1].gain.gain as unknown as FakeParam).ramps.at(-1)).toBe(1);
    expect((node.wet.gain as unknown as FakeParam).ramps.at(-1)).toBeCloseTo(reverbMixToGains(30).wet);
    expect(context.buffers).toHaveLength(2);
  });
});
