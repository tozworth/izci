import { beforeEach, describe, expect, it } from 'vitest';
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
        { id: 'ms-1', type: 'mid-side', enabled: false, midGainDb: -4, sideGainDb: 6 },
        { id: 'eq-1', type: 'mid-side', enabled: true, midGainDb: 0, sideGainDb: 0 },
        { id: 'bad', type: 'future-effect', enabled: true },
        { id: 'nan', type: 'mid-side', enabled: true, midGainDb: Number.NaN, sideGainDb: 0 }
      ]
    });

    expect(result.enabled).toBe(false);
    expect(result.effects.map((effect) => effect.id)).toEqual(['eq-1', 'ms-1']);
    expect(result.effects[0]).toMatchObject({ preampDb: 3 });
  });

  it('clamps finite gains to the declared control domain and rejects malformed EQ arrays', () => {
    const result = normalizeRafSettings({
      enabled: true,
      effects: [
        { id: 'ms', type: 'mid-side', enabled: true, midGainDb: -100, sideGainDb: 100 },
        { id: 'eq', type: 'graphic-eq', enabled: true, preampDb: 0, bandGainsDb: [0] }
      ]
    });

    expect(result.effects).toEqual([{ id: 'ms', type: 'mid-side', enabled: true, midGainDb: -24, sideGainDb: 24 }]);
  });

  it('reorders by stable ID and resets only the selected instance', () => {
    rafSettings.addEffect('graphic-eq');
    rafSettings.addEffect('mid-side');
    const [equalizer, midSide] = rafSettings.getSnapshot().effects;
    rafSettings.updateEffect(equalizer.id, (effect) => ({ ...effect, preampDb: 8 } as typeof equalizer));
    rafSettings.moveEffect(midSide.id, 0);
    rafSettings.resetEffect(equalizer.id);

    const result = rafSettings.getSnapshot().effects;
    expect(result.map((effect) => effect.id)).toEqual([midSide.id, equalizer.id]);
    expect(result[1]).toMatchObject({ id: equalizer.id, preampDb: 0 });
  });
});
