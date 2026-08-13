import type { PatternColorScheme, PatternRowNumberBase, PatternViewerSettings } from '$lib/contracts/player-settings';
import { createSettingsStore } from '$lib/settings/store';

export const PATTERN_VIEWER_SETTINGS_STORAGE_KEY = 'izci.pattern-viewer-settings';
export const PATTERN_VIEWER_SETTINGS_CHANNEL = 'izci.pattern-viewer-settings';
export const MIN_PATTERN_FONT_SIZE = 8;
export const MAX_PATTERN_FONT_SIZE = 16;
export const MIN_PATTERN_ROW_HEIGHT = 14;
export const MAX_PATTERN_ROW_HEIGHT = 28;
export const MIN_PATTERN_CHANNEL_WIDTH = 88;
export const MAX_PATTERN_CHANNEL_WIDTH = 160;

export const DEFAULT_PATTERN_VIEWER_SETTINGS: PatternViewerSettings = {
  fontSize: 10,
  rowHeight: 18,
  channelWidth: 104,
  rowNumberBase: 'hex',
  colorScheme: 'conventional',
  followPlayback: true,
  alwaysCenterActiveRow: true,
  smoothScroll: false,
  showChannelNames: true,
  highlightBeatRows: true
};

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.round(Math.min(Math.max(numericValue, min), max));
}

function normalizeRowNumberBase(value: unknown): PatternRowNumberBase {
  return value === 'decimal' ? 'decimal' : DEFAULT_PATTERN_VIEWER_SETTINGS.rowNumberBase;
}

function normalizeColorScheme(value: unknown): PatternColorScheme {
  return value === 'theme' || value === 'monochrome'
    ? value
    : DEFAULT_PATTERN_VIEWER_SETTINGS.colorScheme;
}

export function normalizePatternViewerSettings(value: unknown): PatternViewerSettings {
  const source = value && typeof value === 'object' ? (value as Partial<PatternViewerSettings>) : {};

  return {
    fontSize: normalizeNumber(
      source.fontSize,
      DEFAULT_PATTERN_VIEWER_SETTINGS.fontSize,
      MIN_PATTERN_FONT_SIZE,
      MAX_PATTERN_FONT_SIZE
    ),
    rowHeight: normalizeNumber(
      source.rowHeight,
      DEFAULT_PATTERN_VIEWER_SETTINGS.rowHeight,
      MIN_PATTERN_ROW_HEIGHT,
      MAX_PATTERN_ROW_HEIGHT
    ),
    channelWidth: normalizeNumber(
      source.channelWidth,
      DEFAULT_PATTERN_VIEWER_SETTINGS.channelWidth,
      MIN_PATTERN_CHANNEL_WIDTH,
      MAX_PATTERN_CHANNEL_WIDTH
    ),
    rowNumberBase: normalizeRowNumberBase(source.rowNumberBase),
    colorScheme: normalizeColorScheme(source.colorScheme),
    followPlayback:
      typeof source.followPlayback === 'boolean'
        ? source.followPlayback
        : DEFAULT_PATTERN_VIEWER_SETTINGS.followPlayback,
    alwaysCenterActiveRow:
      typeof source.alwaysCenterActiveRow === 'boolean'
        ? source.alwaysCenterActiveRow
        : DEFAULT_PATTERN_VIEWER_SETTINGS.alwaysCenterActiveRow,
    smoothScroll:
      typeof source.smoothScroll === 'boolean'
        ? source.smoothScroll
        : DEFAULT_PATTERN_VIEWER_SETTINGS.smoothScroll,
    showChannelNames:
      typeof source.showChannelNames === 'boolean'
        ? source.showChannelNames
        : DEFAULT_PATTERN_VIEWER_SETTINGS.showChannelNames,
    highlightBeatRows:
      typeof source.highlightBeatRows === 'boolean'
        ? source.highlightBeatRows
        : DEFAULT_PATTERN_VIEWER_SETTINGS.highlightBeatRows
  };
}

export const patternViewerSettings = createSettingsStore({
  storageKey: PATTERN_VIEWER_SETTINGS_STORAGE_KEY,
  channelName: PATTERN_VIEWER_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_PATTERN_VIEWER_SETTINGS,
  normalize: normalizePatternViewerSettings
});
