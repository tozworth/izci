import type { VisualizerColorSource, VisualizerSettings, VisualizerStyle } from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const VISUALIZER_SETTINGS_STORAGE_KEY = 'izci.visualizer-settings';
export const VISUALIZER_SETTINGS_CHANNEL = 'izci.visualizer-settings';

export const VISUALIZER_STYLE_OPTIONS: Array<{ value: VisualizerStyle; label: string }> = [
  { value: 'wave', label: 'Uniform wave' },
  { value: 'bars', label: 'Spectrum bars' },
  { value: 'mirror', label: 'Mirror bloom' },
  { value: 'blocks', label: 'Pixel blocks' }
];

export const VISUALIZER_COLOR_SOURCE_OPTIONS: Array<{ value: VisualizerColorSource; label: string }> = [
  { value: 'theme', label: 'Follow theme' },
  { value: 'artwork', label: 'Follow artwork' }
];

export const DEFAULT_VISUALIZER_SETTINGS: VisualizerSettings = {
  style: 'wave',
  colorSource: 'theme',
  height: 0.78,
  transparency: 0.42,
  normalizationStrength: 0.42
};

function normalizeStyle(value: unknown): VisualizerStyle {
  return value === 'bars' || value === 'mirror' || value === 'blocks' || value === 'wave'
    ? value
    : DEFAULT_VISUALIZER_SETTINGS.style;
}

function normalizeColorSource(value: unknown): VisualizerColorSource {
  return value === 'artwork' || value === 'theme' ? value : DEFAULT_VISUALIZER_SETTINGS.colorSource;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(Math.max(numberValue, min), max);
}

function normalizeNormalizationStrength(source: Partial<VisualizerSettings> & { normalization?: unknown }): number {
  if (typeof source.normalizationStrength !== 'undefined') {
    return normalizeNumber(
      source.normalizationStrength,
      DEFAULT_VISUALIZER_SETTINGS.normalizationStrength,
      0,
      1
    );
  }

  if (source.normalization === 'off') {
    return 0;
  }

  if (source.normalization === 'strong') {
    return 0.72;
  }

  if (source.normalization === 'balanced') {
    return 0.42;
  }

  return DEFAULT_VISUALIZER_SETTINGS.normalizationStrength;
}

function normalizeSettings(value: unknown): VisualizerSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<VisualizerSettings> & { normalization?: unknown })
      : {};

  return {
    style: normalizeStyle(source.style),
    colorSource: normalizeColorSource(source.colorSource),
    height: normalizeNumber(source.height, DEFAULT_VISUALIZER_SETTINGS.height, 0.22, 1),
    transparency: normalizeNumber(source.transparency, DEFAULT_VISUALIZER_SETTINGS.transparency, 0, 0.85),
    normalizationStrength: normalizeNormalizationStrength(source)
  };
}

const store = createPersistentStore({
  storageKey: VISUALIZER_SETTINGS_STORAGE_KEY,
  channelName: VISUALIZER_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_VISUALIZER_SETTINGS,
  normalize: normalizeSettings
});

export const visualizerSettings = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  update(patch: Partial<VisualizerSettings>): VisualizerSettings {
    return store.update((settings) => ({ ...settings, ...patch }));
  },
  reset: store.reset
};
