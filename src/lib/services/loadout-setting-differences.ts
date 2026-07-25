import { BACKDROP_ZONE_IDS, DEFAULT_BACKDROP_ZONES } from '$lib/stores/appearance-settings';
import { DEFAULT_MODULE_PLAYBACK_SETTINGS } from '$lib/stores/module-playback-settings';
import { DEFAULT_PLAYBACK_SETTINGS } from '$lib/stores/playback-settings';
import { DEFAULT_RAF_SETTINGS } from '$lib/stores/raf-settings';
import { DEFAULT_VISUALIZER_SETTINGS } from '$lib/stores/visualizer-settings';
import type { LoadoutCategory, LoadoutSettings } from '$lib/types';

export type LoadoutSettingDifferenceKey =
  | 'playbackRate'
  | 'trueSpeed'
  | 'replayGainMode'
  | 'rafPresetName'
  | 'rafEnabled'
  | 'interpolationFilter'
  | 'stereoSeparation'
  | 'panStrength'
  | 'repeatCount'
  | 'tempoFactor'
  | 'pitchFactor'
  | 'backdropLeft'
  | 'backdropCenter'
  | 'backdropRight'
  | 'backdropPlayer'
  | 'backdropNowPlaying'
  | 'visualizerStyle'
  | 'visualizerColorSource'
  | 'visualizerHeight'
  | 'visualizerTransparency'
  | 'visualizerFrameRateLimit'
  | 'visualizerNormalizationStrength'
  | 'visualizerTriangleCount'
  | 'visualizerTriangleMinSize'
  | 'visualizerTriangleMaxSize'
  | 'visualizerTriangleBaseSpeed'
  | 'visualizerTriangleReactiveSpeed'
  | 'visualizerTriangleBorderWidth';

export interface LoadoutSettingDifference {
  key: LoadoutSettingDifferenceKey;
  value: string | number | boolean;
}

const BACKDROP_KEYS = {
  left: 'backdropLeft',
  center: 'backdropCenter',
  right: 'backdropRight',
  player: 'backdropPlayer',
  nowPlaying: 'backdropNowPlaying'
} as const satisfies Record<string, LoadoutSettingDifferenceKey>;

function addDifference(
  differences: LoadoutSettingDifference[],
  key: LoadoutSettingDifferenceKey,
  value: string | number | boolean,
  defaultValue: string | number | boolean
): void {
  if (value !== defaultValue) differences.push({ key, value });
}

export function getLoadoutSettingDifferences(
  settings: LoadoutSettings,
  category: LoadoutCategory
): LoadoutSettingDifference[] {
  const differences: LoadoutSettingDifference[] = [];

  if (category === 'playback' && settings.playback) {
    addDifference(differences, 'playbackRate', settings.playback.playbackRate, DEFAULT_PLAYBACK_SETTINGS.playbackRate);
    addDifference(differences, 'trueSpeed', settings.playback.trueSpeed, DEFAULT_PLAYBACK_SETTINGS.trueSpeed);
    addDifference(differences, 'replayGainMode', settings.playback.replayGainMode, DEFAULT_PLAYBACK_SETTINGS.replayGainMode);
  } else if (category === 'raf' && settings.raf) {
    differences.push({ key: 'rafPresetName', value: settings.raf.presetName });
    addDifference(differences, 'rafEnabled', settings.raf.enabled, DEFAULT_RAF_SETTINGS.enabled);
  } else if (category === 'modules' && settings.modules) {
    addDifference(differences, 'interpolationFilter', settings.modules.interpolationFilter, DEFAULT_MODULE_PLAYBACK_SETTINGS.interpolationFilter);
    addDifference(differences, 'stereoSeparation', settings.modules.stereoSeparation, DEFAULT_MODULE_PLAYBACK_SETTINGS.stereoSeparation);
    addDifference(differences, 'panStrength', settings.modules.panStrength, DEFAULT_MODULE_PLAYBACK_SETTINGS.panStrength);
    addDifference(differences, 'repeatCount', settings.modules.repeatCount, DEFAULT_MODULE_PLAYBACK_SETTINGS.repeatCount);
    addDifference(differences, 'tempoFactor', settings.modules.tempoFactor, DEFAULT_MODULE_PLAYBACK_SETTINGS.tempoFactor);
    addDifference(differences, 'pitchFactor', settings.modules.pitchFactor, DEFAULT_MODULE_PLAYBACK_SETTINGS.pitchFactor);
  } else if (category === 'appearance' && settings.appearance) {
    for (const zone of BACKDROP_ZONE_IDS) {
      addDifference(
        differences,
        BACKDROP_KEYS[zone],
        settings.appearance.backdropZones[zone],
        DEFAULT_BACKDROP_ZONES[zone]
      );
    }

    const visualizer = settings.appearance.visualizer;
    addDifference(differences, 'visualizerStyle', visualizer.style, DEFAULT_VISUALIZER_SETTINGS.style);
    addDifference(differences, 'visualizerColorSource', visualizer.colorSource, DEFAULT_VISUALIZER_SETTINGS.colorSource);
    addDifference(differences, 'visualizerHeight', visualizer.height, DEFAULT_VISUALIZER_SETTINGS.height);
    addDifference(differences, 'visualizerTransparency', visualizer.transparency, DEFAULT_VISUALIZER_SETTINGS.transparency);
    addDifference(differences, 'visualizerFrameRateLimit', visualizer.frameRateLimit, DEFAULT_VISUALIZER_SETTINGS.frameRateLimit);
    addDifference(differences, 'visualizerNormalizationStrength', visualizer.normalizationStrength, DEFAULT_VISUALIZER_SETTINGS.normalizationStrength);

    if (visualizer.style === 'triangles') {
      addDifference(differences, 'visualizerTriangleCount', visualizer.triangleCount, DEFAULT_VISUALIZER_SETTINGS.triangleCount);
      addDifference(differences, 'visualizerTriangleMinSize', visualizer.triangleMinSize, DEFAULT_VISUALIZER_SETTINGS.triangleMinSize);
      addDifference(differences, 'visualizerTriangleMaxSize', visualizer.triangleMaxSize, DEFAULT_VISUALIZER_SETTINGS.triangleMaxSize);
      addDifference(differences, 'visualizerTriangleBaseSpeed', visualizer.triangleBaseSpeed, DEFAULT_VISUALIZER_SETTINGS.triangleBaseSpeed);
      addDifference(differences, 'visualizerTriangleReactiveSpeed', visualizer.triangleReactiveSpeed, DEFAULT_VISUALIZER_SETTINGS.triangleReactiveSpeed);
      addDifference(differences, 'visualizerTriangleBorderWidth', visualizer.triangleBorderWidth, DEFAULT_VISUALIZER_SETTINGS.triangleBorderWidth);
    }
  }

  return differences;
}
