import type { VideoSettings, VideoViewportArea } from '$lib/types';
import { createSettingsStore } from './persistent-store';

export const VIDEO_SETTINGS_STORAGE_KEY = 'izci.video-settings';
export const VIDEO_SETTINGS_CHANNEL = 'izci-video-settings';

export const VIDEO_VIEWPORT_AREA_OPTIONS: Array<{
  value: VideoViewportArea;
  label: string;
}> = [
  { value: 'center', label: 'Center panel' },
  { value: 'left-center', label: 'Left and center' },
  { value: 'center-right', label: 'Center and right' },
  { value: 'all', label: 'All panels' }
];

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  autoResizeWindow: false,
  viewportArea: 'center'
};

export function normalizeVideoViewportArea(value: unknown): VideoViewportArea {
  return value === 'left-center' || value === 'center-right' || value === 'all'
    ? value
    : DEFAULT_VIDEO_SETTINGS.viewportArea;
}

export function normalizeVideoSettings(value: unknown): VideoSettings {
  const source = value && typeof value === 'object' ? (value as Partial<VideoSettings>) : {};

  return {
    autoResizeWindow:
      typeof source.autoResizeWindow === 'boolean'
        ? source.autoResizeWindow
        : DEFAULT_VIDEO_SETTINGS.autoResizeWindow,
    viewportArea: normalizeVideoViewportArea(source.viewportArea)
  };
}

export const videoSettings = createSettingsStore({
  storageKey: VIDEO_SETTINGS_STORAGE_KEY,
  channelName: VIDEO_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_VIDEO_SETTINGS,
  normalize: normalizeVideoSettings
});
