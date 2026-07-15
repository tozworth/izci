import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rafSettings } from '$lib/stores/raf-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import type { RafGraphicEqSettings } from '$lib/types';
import { RafEngine, sameEffectSettings, sameTopology } from './raf-engine';
import { FakeContext } from './raf-effects/test-audio-context';

describe('RafEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playbackSettings.reset();
    rafSettings.reset();
  });

  afterEach(() => {
    rafSettings.reset();
    playbackSettings.reset();
    vi.useRealTimers();
  });

  it('keeps parameter updates on existing nodes and disposes replaced topology', () => {
    const context = new FakeContext();
    const engine = new RafEngine(context as unknown as BaseAudioContext);
    rafSettings.addEffect('graphic-eq');
    const effect = rafSettings.getSnapshot().effects[0] as RafGraphicEqSettings;
    const filterCount = context.filters.length;
    const oldFilters = [...context.filters];

    rafSettings.updateEffect(effect.id, (current) => ({ ...current, preampDb: 6 } as RafGraphicEqSettings));
    expect(context.filters).toHaveLength(filterCount);
    expect(context.gains.some((gain) => gain.gain.ramps.some((value) => value < 1))).toBe(true);

    rafSettings.removeEffect(effect.id);
    vi.advanceTimersByTime(30);
    expect(oldFilters.every((filter) => filter.disconnectCalls > 0)).toBe(true);
    engine.destroy();
  });

  it('updates only the effect whose settings changed', () => {
    const context = new FakeContext();
    const engine = new RafEngine(context as unknown as BaseAudioContext);
    rafSettings.addEffect('graphic-eq');
    rafSettings.addEffect('graphic-eq');
    const effects = rafSettings.getSnapshot().effects as RafGraphicEqSettings[];
    const activeFilters = context.filters.slice(-22);
    const firstFilters = activeFilters.slice(0, 10);
    const secondFilters = activeFilters.slice(11, 21);

    rafSettings.updateEffect(effects[0].id, (effect) => {
      const current = effect as RafGraphicEqSettings;
      const bandGainsDb = [...current.bandGainsDb];
      bandGainsDb[0] = 4;
      return { ...current, bandGainsDb };
    });

    expect(firstFilters[0].gain.ramps).toEqual([4]);
    expect(firstFilters.slice(1).every((filter) => filter.gain.ramps.length === 0)).toBe(true);
    expect(secondFilters.every((filter) => filter.gain.ramps.length === 0)).toBe(true);
    engine.destroy();
  });

  it('ignores a structurally identical rack delivery', () => {
    const context = new FakeContext();
    const engine = new RafEngine(context as unknown as BaseAudioContext);
    rafSettings.addEffect('graphic-eq');
    const activeFilters = context.filters.slice(-11, -1);
    const duplicate = JSON.parse(JSON.stringify(rafSettings.getSnapshot()));

    rafSettings.replace(duplicate);

    expect(activeFilters.every((filter) => filter.gain.ramps.length === 0)).toBe(true);
    engine.destroy();
  });

  it('treats only stable ID/type order as the same topology', () => {
    const first = [{ id: 'a', type: 'stereo-width' as const, enabled: true, widthDb: 0 }];
    expect(sameTopology(first, [{ ...first[0], enabled: false }])).toBe(true);
    expect(sameTopology(first, [{ ...first[0], id: 'b' }])).toBe(false);
  });

  it('compares effect settings structurally', () => {
    const first: RafGraphicEqSettings = {
      id: 'eq',
      type: 'graphic-eq',
      enabled: true,
      preampDb: 0,
      bandGainsDb: [0, 1]
    };

    expect(sameEffectSettings(first, { ...first, bandGainsDb: [...first.bandGainsDb] })).toBe(true);
    expect(sameEffectSettings(first, { ...first, bandGainsDb: [0, 2] })).toBe(false);
  });

  it('keeps the Playback feature gate separate from rack power', () => {
    const context = new FakeContext();
    const engine = new RafEngine(context as unknown as BaseAudioContext);
    const dryGain = context.gains[2];

    expect(playbackSettings.getSnapshot().enableRaf).toBe(false);
    expect(dryGain.gain.ramps.at(-1)).toBe(1);

    playbackSettings.update({ enableRaf: true });
    expect(dryGain.gain.ramps.at(-1)).toBe(0);

    rafSettings.setEnabled(false);
    expect(playbackSettings.getSnapshot().enableRaf).toBe(true);
    expect(dryGain.gain.ramps.at(-1)).toBe(1);
    engine.destroy();
  });
});
