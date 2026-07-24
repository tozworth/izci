import type { VideoFitMode, VideoSettings } from '$lib/types';
import { createSettingsStore } from './persistent-store';

export const VIDEO_SETTINGS_STORAGE_KEY = 'izci.video-settings';
export const VIDEO_SETTINGS_CHANNEL = 'izci-video-settings';

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  autoResizeWindow: false,
  autoEnterTheater: false,
  fitMode: 'contain'
};

function normalizeFitMode(value: unknown): VideoFitMode {
  return value === 'cover' ? value : DEFAULT_VIDEO_SETTINGS.fitMode;
}

export function normalizeVideoSettings(value: unknown): VideoSettings {
  const source = value && typeof value === 'object' ? (value as Partial<VideoSettings>) : {};

  return {
    autoResizeWindow:
      typeof source.autoResizeWindow === 'boolean'
        ? source.autoResizeWindow
        : DEFAULT_VIDEO_SETTINGS.autoResizeWindow,
    autoEnterTheater:
      typeof source.autoEnterTheater === 'boolean'
        ? source.autoEnterTheater
        : DEFAULT_VIDEO_SETTINGS.autoEnterTheater,
    fitMode: normalizeFitMode(source.fitMode)
  };
}

export const videoSettings = createSettingsStore({
  storageKey: VIDEO_SETTINGS_STORAGE_KEY,
  channelName: VIDEO_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_VIDEO_SETTINGS,
  normalize: normalizeVideoSettings
});
