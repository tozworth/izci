import { beforeEach, describe, expect, it } from 'vitest';
import { CRYSTALIZER_FREQUENCIES } from '$lib/services/raf-effects/crystalizer';
import { GRAPHIC_EQ_FREQUENCIES } from '$lib/services/raf-effects/graphic-eq';
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
        { id: 'width-1', type: 'stereo-width', enabled: false, widthDb: 10 },
        {
          id: 'crystalizer-1',
          type: 'crystalizer',
          enabled: true,
          bandIntensities: CRYSTALIZER_FREQUENCIES.map(() => 4),
          bandMuted: CRYSTALIZER_FREQUENCIES.map(() => false),
          bandBypassed: CRYSTALIZER_FREQUENCIES.map(() => false)
        },
        { id: 'eq-1', type: 'stereo-width', enabled: true, widthDb: 0 },
        { id: 'bad', type: 'future-effect', enabled: true },
        { id: 'nan', type: 'stereo-width', enabled: true, widthDb: Number.NaN }
      ]
    });

    expect(result.enabled).toBe(false);
    expect(result.effects.map((effect) => effect.id)).toEqual(['eq-1', 'width-1', 'crystalizer-1']);
    expect(result.effects[0]).toMatchObject({ preampDb: 3 });
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
});
