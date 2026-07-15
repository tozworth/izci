import { beforeEach, describe, expect, it } from 'vitest';
import { CRYSTALIZER_FREQUENCIES } from '$lib/services/raf-effects/crystalizer';
import { GRAPHIC_EQ_FREQUENCIES } from '$lib/services/raf-effects/graphic-eq';
import { mapSlopToParameters } from '$lib/services/raf-effects/sloptimizer';
import { DEFAULT_RAF_SETTINGS, normalizeRafSettings, rafSettings } from './raf-settings';

describe('normalizeRafSettings', () => {
  beforeEach(() => rafSettings.reset());

  it('uses a transparent empty rack for invalid state', () => {
    expect(normalizeRafSettings(null)).toEqual(DEFAULT_RAF_SETTINGS);
  });

  it('preserves valid order and parameters while dropping invalid and duplicate effects', () => {
    const result = normalizeRafSettings({
      enabled: false,
      effects: [
        { id: 'eq-1', type: 'graphic-eq', enabled: true, preampDb: 3, bandGainsDb: GRAPHIC_EQ_FREQUENCIES.map(() => 2) },
        { id: 'width-1', type: 'stereo-width', enabled: false, displayName: '  Wide   room  ', widthDb: 10 },
        {
          id: 'crystalizer-1',
          type: 'crystalizer',
          enabled: true,
          bandIntensities: CRYSTALIZER_FREQUENCIES.map(() => 4),
          bandMuted: CRYSTALIZER_FREQUENCIES.map(() => false),
          bandBypassed: CRYSTALIZER_FREQUENCIES.map(() => false)
        },
        {
          id: 'sloptimizer-1',
          type: 'sloptimizer',
          enabled: true,
          advanced: false,
          slop: 50,
          customized: false,
          lowLiftDb: 2,
          midLiftDb: 4,
          highLiftDb: 6,
          lowCrossoverHz: 220,
          highCrossoverHz: 4_000,
          density: 60,
          speed: 55,
          ceilingDb: -1
        },
        {
          id: 'reverb-1',
          type: 'reverb',
          enabled: true,
          mix: 22,
          roomSize: 70,
          decaySeconds: 3.4,
          preDelayMs: 25,
          dampingHz: 7_500
        },
        { id: 'eq-1', type: 'stereo-width', enabled: true, widthDb: 0 },
        { id: 'bad', type: 'future-effect', enabled: true },
        { id: 'nan', type: 'stereo-width', enabled: true, widthDb: Number.NaN }
      ]
    });

    expect(result.enabled).toBe(false);
    expect(result.effects.map((effect) => effect.id)).toEqual(['eq-1', 'width-1', 'crystalizer-1', 'sloptimizer-1', 'reverb-1']);
    expect(result.effects[0]).toMatchObject({ preampDb: 3 });
    expect(result.effects[1]).toMatchObject({ displayName: 'Wide room' });
    expect(result.effects[3]).toMatchObject(mapSlopToParameters(50));
    expect(result.effects[3]).toMatchObject({ lowCrossoverHz: 220, highCrossoverHz: 4_000 });
    expect(result.effects[4]).toMatchObject({ mix: 22, decaySeconds: 3.4, dampingHz: 7_500 });
  });

  it('clamps finite gains to the declared control domain and rejects malformed EQ arrays', () => {
    const result = normalizeRafSettings({
      enabled: true,
      effects: [
        { id: 'width', type: 'stereo-width', enabled: true, widthDb: 100 },
        { id: 'eq', type: 'graphic-eq', enabled: true, preampDb: 0, bandGainsDb: [0] }
      ]
    });

    expect(result.effects).toEqual([{ id: 'width', type: 'stereo-width', enabled: true, widthDb: 24 }]);
  });

  it('clamps crystalizer intensities and rejects malformed per-band state', () => {
    const validFlags = CRYSTALIZER_FREQUENCIES.map(() => false);
    const result = normalizeRafSettings({
      enabled: true,
      effects: [
        {
          id: 'crystalizer',
          type: 'crystalizer',
          enabled: true,
          bandIntensities: CRYSTALIZER_FREQUENCIES.map(() => 100),
          bandMuted: validFlags,
          bandBypassed: validFlags
        },
        {
          id: 'broken',
          type: 'crystalizer',
          enabled: true,
          bandIntensities: [0],
          bandMuted: validFlags,
          bandBypassed: validFlags
        }
      ]
    });

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({ bandIntensities: CRYSTALIZER_FREQUENCIES.map(() => 32) });
  });

  it('clamps Sloptimizer controls while preserving macro customization state', () => {
    const result = normalizeRafSettings({
      enabled: true,
      effects: [{
        id: 'sloptimizer',
        type: 'sloptimizer',
        enabled: true,
        advanced: true,
        slop: 140,
        customized: true,
        lowLiftDb: -20,
        midLiftDb: 20,
        highLiftDb: 5,
        lowCrossoverHz: 20,
        highCrossoverHz: 20_000,
        density: 120,
        speed: -10,
        ceilingDb: -20
      }]
    });

    expect(result.effects[0]).toMatchObject({
      slop: 100,
      customized: true,
      lowLiftDb: -6,
      midLiftDb: 12,
      lowCrossoverHz: 60,
      highCrossoverHz: 8_000,
      density: 100,
      speed: 0,
      ceilingDb: -6
    });
  });

  it('clamps reverb controls to safe DSP ranges', () => {
    const result = normalizeRafSettings({
      enabled: true,
      effects: [{
        id: 'reverb',
        type: 'reverb',
        enabled: true,
        mix: 150,
        roomSize: -10,
        decaySeconds: 20,
        preDelayMs: -4,
        dampingHz: 50_000
      }]
    });

    expect(result.effects[0]).toMatchObject({
      mix: 100,
      roomSize: 0,
      decaySeconds: 8,
      preDelayMs: 0,
      dampingHz: 20_000
    });
  });

  it('reorders by stable ID and resets only the selected instance', () => {
    rafSettings.addEffect('graphic-eq');
    rafSettings.addEffect('stereo-width');
    const [equalizer, midSide] = rafSettings.getSnapshot().effects;
    rafSettings.updateEffect(equalizer.id, (effect) => ({ ...effect, preampDb: 8 } as typeof equalizer));
    rafSettings.moveEffect(midSide.id, 0);
    rafSettings.resetEffect(equalizer.id);

    const result = rafSettings.getSnapshot().effects;
    expect(result.map((effect) => effect.id)).toEqual([midSide.id, equalizer.id]);
    expect(result[1]).toMatchObject({ id: equalizer.id, preampDb: 0 });
  });

  it('renames, clones, and resets effect instances without losing their display name', () => {
    rafSettings.addEffect('stereo-width');
    const source = rafSettings.getSnapshot().effects[0];
    rafSettings.renameEffect(source.id, '  Side   shimmer  ');
    const clonedSettings = rafSettings.cloneEffect(source.id);

    expect(clonedSettings.effects).toHaveLength(2);
    expect(clonedSettings.effects[0]).toMatchObject({ displayName: 'Side shimmer' });
    expect(clonedSettings.effects[1]).toMatchObject({ displayName: 'Side shimmer' });
    expect(clonedSettings.effects[1].id).not.toBe(source.id);

    rafSettings.resetEffect(source.id);
    expect(rafSettings.getSnapshot().effects[0]).toMatchObject({ displayName: 'Side shimmer' });
    rafSettings.renameEffect(source.id, '   ');
    expect(rafSettings.getSnapshot().effects[0]).not.toHaveProperty('displayName');
  });
});
