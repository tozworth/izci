import type { MetadataSettings } from '$lib/contracts/player-settings';
import { createSettingsStore } from './persistent-store';

export const METADATA_SETTINGS_STORAGE_KEY = 'izci.metadata-settings';
export const METADATA_SETTINGS_CHANNEL = 'izci.metadata-settings';
export const DEFAULT_PLAY_COUNT_THRESHOLD_SECONDS = 15;
export const MIN_PLAY_COUNT_THRESHOLD_SECONDS = 1;
export const MAX_PLAY_COUNT_THRESHOLD_SECONDS = 3600;

export const DEFAULT_METADATA_SETTINGS: MetadataSettings = {
  inferFromFilename: true,
  playCountThresholdSeconds: DEFAULT_PLAY_COUNT_THRESHOLD_SECONDS
};

export function normalizePlayCountThresholdSeconds(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_PLAY_COUNT_THRESHOLD_SECONDS;
  }

  return Math.min(
    MAX_PLAY_COUNT_THRESHOLD_SECONDS,
    Math.max(MIN_PLAY_COUNT_THRESHOLD_SECONDS, Math.round(parsed))
  );
}

function normalizeSettings(value: unknown): MetadataSettings {
  const source = value && typeof value === 'object' ? (value as Partial<MetadataSettings>) : {};

  return {
    inferFromFilename:
      typeof source.inferFromFilename === 'boolean'
        ? source.inferFromFilename
        : DEFAULT_METADATA_SETTINGS.inferFromFilename,
    playCountThresholdSeconds: normalizePlayCountThresholdSeconds(source.playCountThresholdSeconds)
  };
}

export const metadataSettings = createSettingsStore({
  storageKey: METADATA_SETTINGS_STORAGE_KEY,
  channelName: METADATA_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_METADATA_SETTINGS,
  normalize: normalizeSettings
});
