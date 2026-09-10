import type { VideoFitMode, VideoSettings } from '$lib/types';
import { createSettingsStore, normalizeBoolean } from './persistent-store';

const VIDEO_SETTINGS_STORAGE_KEY = 'izci.video-settings';
const VIDEO_SETTINGS_CHANNEL = 'izci-video-settings';

export const IMAGE_ZOOM_MIN = 1;
export const IMAGE_ZOOM_MAX = 8;
export const IMAGE_ZOOM_BUTTON_FACTOR = 1.25;
export const IMAGE_ZOOM_WHEEL_FACTOR = 1.15;

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  autoResizeWindow: false,
  autoEnterTheater: false,
  fitMode: 'contain',
  imageZoom: IMAGE_ZOOM_MIN
};

function normalizeFitMode(value: unknown): VideoFitMode {
  return value === 'cover' ? value : DEFAULT_VIDEO_SETTINGS.fitMode;
}

export function normalizeImageZoom(value: unknown): number {
  const zoom = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_VIDEO_SETTINGS.imageZoom;
  return Math.min(Math.max(Math.round(zoom * 100) / 100, IMAGE_ZOOM_MIN), IMAGE_ZOOM_MAX);
}

export function stepImageZoom(currentZoom: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    return normalizeImageZoom(currentZoom);
  }

  return normalizeImageZoom(normalizeImageZoom(currentZoom) * factor);
}

export function normalizeVideoSettings(value: unknown): VideoSettings {
  const source = value && typeof value === 'object' ? (value as Partial<VideoSettings>) : {};

  return {
    autoResizeWindow: normalizeBoolean(source.autoResizeWindow, DEFAULT_VIDEO_SETTINGS.autoResizeWindow),
    autoEnterTheater: normalizeBoolean(source.autoEnterTheater, DEFAULT_VIDEO_SETTINGS.autoEnterTheater),
    fitMode: normalizeFitMode(source.fitMode),
    imageZoom: normalizeImageZoom(source.imageZoom)
  };
}

export const videoSettings = createSettingsStore({
  storageKey: VIDEO_SETTINGS_STORAGE_KEY,
  channelName: VIDEO_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_VIDEO_SETTINGS,
  normalize: normalizeVideoSettings
});
