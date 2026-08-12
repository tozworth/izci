import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKDROP_ZONES } from '$lib/stores/appearance-settings';
import { DEFAULT_MODULE_PLAYBACK_SETTINGS } from '$lib/stores/module-playback-settings';
import { DEFAULT_VISUALIZER_SETTINGS } from '$lib/stores/visualizer-settings';
import type { LoadoutSettings } from '$lib/contracts/loadouts';
import { getLoadoutSettingDifferences } from './loadout-setting-differences';

describe('loadout setting differences', () => {
  it('returns only playback values that differ from defaults', () => {
    expect(getLoadoutSettingDifferences({
      playback: {
        playbackRate: 0.75,
        trueSpeed: true,
        replayGainMode: 'track',
        modules: { ...DEFAULT_MODULE_PLAYBACK_SETTINGS }
      }
    }, 'playback')).toEqual([
      { key: 'playbackRate', value: 0.75 },
      { key: 'trueSpeed', value: true }
    ]);
  });

  it('always identifies the Raf preset and includes a non-default bypass state', () => {
    expect(getLoadoutSettingDifferences({
      raf: { presetName: 'Light V-shape and 4 mid', enabled: false }
    }, 'raf')).toEqual([
      { key: 'rafPresetName', value: 'Light V-shape and 4 mid' },
      { key: 'rafEnabled', value: false }
    ]);
  });

  it('includes non-default module values under playback', () => {
    expect(getLoadoutSettingDifferences({
      playback: {
        playbackRate: 1,
        trueSpeed: false,
        replayGainMode: 'track',
        modules: { ...DEFAULT_MODULE_PLAYBACK_SETTINGS, panStrength: 0 }
      }
    }, 'playback')).toEqual([{ key: 'panStrength', value: 0 }]);
  });

  it('reports changed backdrops and applicable visualizer settings', () => {
    const appearance: NonNullable<LoadoutSettings['appearance']> = {
      backdropZones: { ...DEFAULT_BACKDROP_ZONES, player: 'both' },
      visualizer: {
        ...DEFAULT_VISUALIZER_SETTINGS,
        style: 'triangles',
        triangleCount: 24
      }
    };

    expect(getLoadoutSettingDifferences({ appearance }, 'appearance')).toEqual([
      { key: 'backdropPlayer', value: 'both' },
      { key: 'visualizerStyle', value: 'triangles' },
      { key: 'visualizerTriangleCount', value: 24 }
    ]);
  });

  it('hides dormant triangle settings for other visualizer styles', () => {
    const appearance: NonNullable<LoadoutSettings['appearance']> = {
      backdropZones: { ...DEFAULT_BACKDROP_ZONES },
      visualizer: { ...DEFAULT_VISUALIZER_SETTINGS, triangleCount: 24 }
    };

    expect(getLoadoutSettingDifferences({ appearance }, 'appearance')).toEqual([]);
  });
});
