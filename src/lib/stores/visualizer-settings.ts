import type { VisualizerColorSource, VisualizerSettings, VisualizerStyle } from '$lib/types';
import { createSettingsStore } from './persistent-store';

const VISUALIZER_SETTINGS_STORAGE_KEY = 'izci.visualizer-settings';
const VISUALIZER_SETTINGS_CHANNEL = 'izci.visualizer-settings';
export const MIN_VISUALIZER_FRAME_RATE_LIMIT = 30;
export const MAX_VISUALIZER_FRAME_RATE_LIMIT = 240;

export const VISUALIZER_STYLE_OPTIONS: Array<{ value: VisualizerStyle; label: string }> = [
  { value: 'wave', label: 'Uniform wave' },
  { value: 'bars', label: 'Spectrum bars' },
  { value: 'mirror', label: 'Mirror bloom' },
  { value: 'blocks', label: 'Pixel blocks' },
  { value: 'triangles', label: 'Rhythm triangles' },
  { value: 'milkdrop', label: 'MilkDrop' }
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
  frameRateLimit: 60,
  normalizationStrength: 0.42,
  triangleCount: 64,
  triangleMinSize: 0.14,
  triangleMaxSize: 0.56,
  triangleBaseSpeed: 1,
  triangleReactiveSpeed: 1,
  triangleBorderWidth: 1,
  milkDropPreset: '',
  milkDropCyclePresets: true,
  milkDropCycleSeconds: 30,
  milkDropBlendSeconds: 3,
  milkDropResolution: 1
};

function normalizeStyle(value: unknown): VisualizerStyle {
  return VISUALIZER_STYLE_OPTIONS.some((option) => option.value === value)
    ? value as VisualizerStyle
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

export function normalizeVisualizerSettings(value: unknown): VisualizerSettings {
  const source = value && typeof value === 'object' ? (value as Partial<VisualizerSettings>) : {};

  return {
    style: normalizeStyle(source.style),
    colorSource: normalizeColorSource(source.colorSource),
    height: normalizeNumber(source.height, DEFAULT_VISUALIZER_SETTINGS.height, 0.22, 1),
    transparency: normalizeNumber(source.transparency, DEFAULT_VISUALIZER_SETTINGS.transparency, 0, 0.85),
    frameRateLimit: Math.round(
      normalizeNumber(
        source.frameRateLimit,
        DEFAULT_VISUALIZER_SETTINGS.frameRateLimit,
        MIN_VISUALIZER_FRAME_RATE_LIMIT,
        MAX_VISUALIZER_FRAME_RATE_LIMIT
      )
    ),
    normalizationStrength: normalizeNumber(
      source.normalizationStrength,
      DEFAULT_VISUALIZER_SETTINGS.normalizationStrength,
      0,
      1
    ),
    triangleCount: Math.round(normalizeNumber(source.triangleCount, DEFAULT_VISUALIZER_SETTINGS.triangleCount, 8, 160)),
    triangleMinSize: normalizeNumber(source.triangleMinSize, DEFAULT_VISUALIZER_SETTINGS.triangleMinSize, 0.04, 0.8),
    triangleMaxSize: Math.max(
      normalizeNumber(source.triangleMinSize, DEFAULT_VISUALIZER_SETTINGS.triangleMinSize, 0.04, 0.8),
      normalizeNumber(source.triangleMaxSize, DEFAULT_VISUALIZER_SETTINGS.triangleMaxSize, 0.08, 1.2)
    ),
    triangleBaseSpeed: normalizeNumber(source.triangleBaseSpeed, DEFAULT_VISUALIZER_SETTINGS.triangleBaseSpeed, 0.2, 3),
    triangleReactiveSpeed: normalizeNumber(
      source.triangleReactiveSpeed,
      DEFAULT_VISUALIZER_SETTINGS.triangleReactiveSpeed,
      0,
      3
    ),
    triangleBorderWidth: normalizeNumber(source.triangleBorderWidth, DEFAULT_VISUALIZER_SETTINGS.triangleBorderWidth, 0, 12),
    milkDropPreset: typeof source.milkDropPreset === 'string' ? source.milkDropPreset.trim() : '',
    milkDropCyclePresets: typeof source.milkDropCyclePresets === 'boolean'
      ? source.milkDropCyclePresets : DEFAULT_VISUALIZER_SETTINGS.milkDropCyclePresets,
    milkDropCycleSeconds: normalizeNumber(source.milkDropCycleSeconds, DEFAULT_VISUALIZER_SETTINGS.milkDropCycleSeconds, 5, 300),
    milkDropBlendSeconds: normalizeNumber(source.milkDropBlendSeconds, DEFAULT_VISUALIZER_SETTINGS.milkDropBlendSeconds, 0, 10),
    milkDropResolution: normalizeNumber(source.milkDropResolution, DEFAULT_VISUALIZER_SETTINGS.milkDropResolution, 0.25, 2)
  };
}

export const visualizerSettings = createSettingsStore({
  storageKey: VISUALIZER_SETTINGS_STORAGE_KEY,
  channelName: VISUALIZER_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_VISUALIZER_SETTINGS,
  normalize: normalizeVisualizerSettings
});
