import type {
  OdaBackground,
  OdaBrowserLayout,
  OdaBrowserLayouts,
  OdaBrowserMedium,
  OdaBrowserZoomLevels,
  OdaHoldBackAction,
  OdaLayout,
  OdaSettings
} from '$lib/types';
import { createSettingsStore, normalizeBoolean } from './persistent-store';

const ODA_SETTINGS_STORAGE_KEY = 'izci.oda-settings';
const ODA_SETTINGS_CHANNEL = 'izci-oda-settings';

export const ODA_OVERSCAN_MIN_PERCENT = 0;
export const ODA_OVERSCAN_MAX_PERCENT = 10;
export const ODA_ARROW_REPEAT_INITIAL_DELAY_MIN_MS = 0;
export const ODA_ARROW_REPEAT_INITIAL_DELAY_MAX_MS = 2_000;
export const ODA_ARROW_REPEAT_INTERVAL_MIN_MS = 30;
export const ODA_ARROW_REPEAT_INTERVAL_MAX_MS = 1_000;
export const ODA_HOLD_BACK_THRESHOLD_MIN_MS = 300;
export const ODA_HOLD_BACK_THRESHOLD_MAX_MS = 2_000;

export const ODA_BACKGROUND_OPACITY_MIN_PERCENT = 0;
export const ODA_BACKGROUND_OPACITY_MAX_PERCENT = 100;
export const ODA_BROWSER_ZOOM_MIN = 0;
export const ODA_BROWSER_ZOOM_MAX = 4;

const ODA_BROWSER_MEDIA: readonly OdaBrowserMedium[] = ['music', 'video', 'image'];
const ODA_BROWSER_LAYOUTS: readonly OdaBrowserLayout[] = ['list', 'grid', 'gallery'];

const DEFAULT_ODA_BROWSER_LAYOUTS: OdaBrowserLayouts = {
  music: 'grid',
  video: 'grid',
  image: 'grid'
};

const DEFAULT_ODA_BROWSER_ZOOM_LEVELS: OdaBrowserZoomLevels = {
  music: { list: 2, grid: 2, gallery: 2 },
  video: { list: 2, grid: 2, gallery: 2 },
  image: { list: 2, grid: 2, gallery: 2 }
};

export const DEFAULT_ODA_SETTINGS: OdaSettings = {
  odaLayout: 'waterfall',
  odaEnterFullscreen: true,
  odaWrapNavigation: false,
  odaBrowserLayouts: DEFAULT_ODA_BROWSER_LAYOUTS,
  odaBrowserZoomLevels: DEFAULT_ODA_BROWSER_ZOOM_LEVELS,
  odaOverscanPercent: 0,
  odaBackground: 'none',
  odaBackgroundImage: null,
  odaBackgroundOpacity: 50,
  odaArrowRepeatInitialDelayMs: 450,
  odaArrowRepeatIntervalMs: 130,
  odaHoldBackAction: 'none',
  odaHoldBackThresholdMs: 800
};

function normalizeLayout(value: unknown): OdaLayout {
  return value === 'waterfall' ? value : DEFAULT_ODA_SETTINGS.odaLayout;
}

function normalizeHoldBackAction(value: unknown): OdaHoldBackAction {
  return value === 'return-home' ? value : DEFAULT_ODA_SETTINGS.odaHoldBackAction;
}

function normalizeBrowserLayout(value: unknown, medium: OdaBrowserMedium): OdaBrowserLayout {
  if (value === 'list' || value === 'grid') return value;
  if (value === 'gallery' && medium !== 'music') return value;
  return DEFAULT_ODA_BROWSER_LAYOUTS[medium];
}

function normalizeBrowserLayouts(value: unknown): OdaBrowserLayouts {
  const source = value && typeof value === 'object'
    ? value as Partial<Record<OdaBrowserMedium, unknown>>
    : {};
  return Object.fromEntries(ODA_BROWSER_MEDIA.map((medium) => [
    medium,
    normalizeBrowserLayout(source[medium], medium)
  ])) as OdaBrowserLayouts;
}

function normalizeBrowserZoomLevels(value: unknown): OdaBrowserZoomLevels {
  const source = value && typeof value === 'object'
    ? value as Partial<Record<OdaBrowserMedium, unknown>>
    : {};
  return Object.fromEntries(ODA_BROWSER_MEDIA.map((medium) => {
    const mediumSource = source[medium] && typeof source[medium] === 'object'
      ? source[medium] as Partial<Record<OdaBrowserLayout, unknown>>
      : {};
    return [medium, Object.fromEntries(ODA_BROWSER_LAYOUTS.map((layout) => [
      layout,
      Math.round(normalizeBoundedNumber(
        mediumSource[layout],
        DEFAULT_ODA_BROWSER_ZOOM_LEVELS[medium][layout],
        ODA_BROWSER_ZOOM_MIN,
        ODA_BROWSER_ZOOM_MAX
      ))
    ]))];
  })) as OdaBrowserZoomLevels;
}

function normalizeBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function normalizeBackground(value: unknown): OdaBackground {
  return value === 'custom' ? value : DEFAULT_ODA_SETTINGS.odaBackground;
}

function normalizeBackgroundImage(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
}

function normalizeBackgroundOpacity(value: unknown): number {
  return Math.round(
    normalizeBoundedNumber(
      value,
      DEFAULT_ODA_SETTINGS.odaBackgroundOpacity,
      ODA_BACKGROUND_OPACITY_MIN_PERCENT,
      ODA_BACKGROUND_OPACITY_MAX_PERCENT
    )
  );
}

function normalizeOverscanPercent(value: unknown): number {
  const percent = normalizeBoundedNumber(
    value,
    DEFAULT_ODA_SETTINGS.odaOverscanPercent,
    ODA_OVERSCAN_MIN_PERCENT,
    ODA_OVERSCAN_MAX_PERCENT
  );
  return Math.round(percent * 10) / 10;
}

function normalizeDurationMs(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(normalizeBoundedNumber(value, fallback, min, max));
}

export function normalizeOdaSettings(value: unknown): OdaSettings {
  const source = value && typeof value === 'object' ? (value as Partial<OdaSettings>) : {};

  return {
    odaLayout: normalizeLayout(source.odaLayout),
    odaEnterFullscreen: normalizeBoolean(
      source.odaEnterFullscreen,
      DEFAULT_ODA_SETTINGS.odaEnterFullscreen
    ),
    odaWrapNavigation: normalizeBoolean(
      source.odaWrapNavigation,
      DEFAULT_ODA_SETTINGS.odaWrapNavigation
    ),
    odaBrowserLayouts: normalizeBrowserLayouts(source.odaBrowserLayouts),
    odaBrowserZoomLevels: normalizeBrowserZoomLevels(source.odaBrowserZoomLevels),
    odaOverscanPercent: normalizeOverscanPercent(source.odaOverscanPercent),
    odaBackground: normalizeBackground(source.odaBackground),
    odaBackgroundImage: normalizeBackgroundImage(source.odaBackgroundImage),
    odaBackgroundOpacity: normalizeBackgroundOpacity(source.odaBackgroundOpacity),
    odaArrowRepeatInitialDelayMs: normalizeDurationMs(
      source.odaArrowRepeatInitialDelayMs,
      DEFAULT_ODA_SETTINGS.odaArrowRepeatInitialDelayMs,
      ODA_ARROW_REPEAT_INITIAL_DELAY_MIN_MS,
      ODA_ARROW_REPEAT_INITIAL_DELAY_MAX_MS
    ),
    odaArrowRepeatIntervalMs: normalizeDurationMs(
      source.odaArrowRepeatIntervalMs,
      DEFAULT_ODA_SETTINGS.odaArrowRepeatIntervalMs,
      ODA_ARROW_REPEAT_INTERVAL_MIN_MS,
      ODA_ARROW_REPEAT_INTERVAL_MAX_MS
    ),
    odaHoldBackAction: normalizeHoldBackAction(source.odaHoldBackAction),
    odaHoldBackThresholdMs: normalizeDurationMs(
      source.odaHoldBackThresholdMs,
      DEFAULT_ODA_SETTINGS.odaHoldBackThresholdMs,
      ODA_HOLD_BACK_THRESHOLD_MIN_MS,
      ODA_HOLD_BACK_THRESHOLD_MAX_MS
    )
  };
}

export const odaSettings = createSettingsStore({
  storageKey: ODA_SETTINGS_STORAGE_KEY,
  channelName: ODA_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_ODA_SETTINGS,
  normalize: normalizeOdaSettings
});
