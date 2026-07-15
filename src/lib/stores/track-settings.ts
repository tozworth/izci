import type { TrackSettings } from '$lib/types';
import { createSettingsStore } from './persistent-store';

export const TRACK_SETTINGS_STORAGE_KEY = 'izci.track-settings';
export const TRACK_SETTINGS_CHANNEL = 'izci.track-settings';
export const DEFAULT_FOLDER_NESTING_LIMIT = 8;
export const MIN_FOLDER_NESTING_LIMIT = 0;
export const MAX_FOLDER_NESTING_LIMIT = 64;

export const DEFAULT_TRACK_SETTINGS: TrackSettings = {
  folderNestingLimit: DEFAULT_FOLDER_NESTING_LIMIT,
  verifyAddedFiles: false,
  associatedFileAction: 'replace'
};

export function normalizeFolderNestingLimit(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_FOLDER_NESTING_LIMIT;
  }

  return Math.min(
    MAX_FOLDER_NESTING_LIMIT,
    Math.max(MIN_FOLDER_NESTING_LIMIT, Math.round(parsed))
  );
}

function normalizeSettings(value: unknown): TrackSettings {
  const source = value && typeof value === 'object' ? (value as Partial<TrackSettings>) : {};

  return {
    folderNestingLimit: normalizeFolderNestingLimit(source.folderNestingLimit),
    verifyAddedFiles:
      typeof source.verifyAddedFiles === 'boolean'
        ? source.verifyAddedFiles
        : DEFAULT_TRACK_SETTINGS.verifyAddedFiles,
    associatedFileAction:
      source.associatedFileAction === 'add' || source.associatedFileAction === 'replace'
        ? source.associatedFileAction
        : DEFAULT_TRACK_SETTINGS.associatedFileAction
  };
}

export const trackSettings = createSettingsStore({
  storageKey: TRACK_SETTINGS_STORAGE_KEY,
  channelName: TRACK_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_TRACK_SETTINGS,
  normalize: normalizeSettings
});
