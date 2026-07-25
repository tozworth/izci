import type { PlaybackRestoreMode, PlaybackSettings, ReplayGainMode } from '$lib/types';
import { createSettingsStore } from './persistent-store';

export const PLAYBACK_SETTINGS_STORAGE_KEY = 'izci.playback-settings';
export const PLAYBACK_SETTINGS_CHANNEL = 'izci-playback-settings';

export const REPLAY_GAIN_MODE_OPTIONS: Array<{ value: ReplayGainMode; label: string }> = [
  { value: 'track', label: 'Track' },
  { value: 'album', label: 'Album' },
  { value: 'off', label: 'Off' }
];

export const PLAYBACK_RESTORE_MODE_OPTIONS: Array<{
  value: PlaybackRestoreMode;
  label: string;
}> = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'position', label: 'Position only' },
  { value: 'position-and-state', label: 'Position and state' }
];

export const REMEMBER_PROGRESS_DURATION_MINUTES = [null, 0, 5, 15, 30, 60, 120, 300, 600] as const;
export const DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX = 4;
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2;
export const PLAYBACK_RATE_STEP = 0.05;

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  playbackRate: 1,
  trueSpeed: false,
  logarithmicVolume: true,
  replayGainMode: 'track',
  restoreMode: 'disabled',
  rememberProgressDurationIndex: DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX,
  enableRaf: false,
  showRafToggleInPlayerBar: false
};

function normalizeReplayGainMode(value: unknown): ReplayGainMode {
  return value === 'off' || value === 'track' || value === 'album'
    ? value
    : DEFAULT_PLAYBACK_SETTINGS.replayGainMode;
}

export function normalizePlaybackRestoreMode(value: unknown): PlaybackRestoreMode {
  return value === 'disabled' || value === 'position' || value === 'position-and-state'
    ? value
    : DEFAULT_PLAYBACK_SETTINGS.restoreMode;
}

export function normalizeRememberProgressDurationIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX;
  }

  return Math.min(
    Math.max(Math.round(value), 0),
    REMEMBER_PROGRESS_DURATION_MINUTES.length - 1
  );
}

export function normalizePlaybackRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PLAYBACK_SETTINGS.playbackRate;
  }

  const clamped = Math.min(Math.max(value, PLAYBACK_RATE_MIN), PLAYBACK_RATE_MAX);
  const stepped = Math.round(clamped / PLAYBACK_RATE_STEP) * PLAYBACK_RATE_STEP;
  return Number(stepped.toFixed(2));
}

export function normalizePlaybackSettings(value: unknown): PlaybackSettings {
  const source = value && typeof value === 'object' ? (value as Partial<PlaybackSettings>) : {};

  return {
    playbackRate: normalizePlaybackRate(source.playbackRate),
    trueSpeed:
      typeof source.trueSpeed === 'boolean'
        ? source.trueSpeed
        : DEFAULT_PLAYBACK_SETTINGS.trueSpeed,
    logarithmicVolume:
      typeof source.logarithmicVolume === 'boolean'
        ? source.logarithmicVolume
        : DEFAULT_PLAYBACK_SETTINGS.logarithmicVolume,
    replayGainMode: normalizeReplayGainMode(source.replayGainMode),
    restoreMode: normalizePlaybackRestoreMode(source.restoreMode),
    rememberProgressDurationIndex: normalizeRememberProgressDurationIndex(
      source.rememberProgressDurationIndex
    ),
    enableRaf:
      typeof source.enableRaf === 'boolean' ? source.enableRaf : DEFAULT_PLAYBACK_SETTINGS.enableRaf,
    showRafToggleInPlayerBar:
      typeof source.showRafToggleInPlayerBar === 'boolean'
        ? source.showRafToggleInPlayerBar
        : DEFAULT_PLAYBACK_SETTINGS.showRafToggleInPlayerBar
  };
}

export const playbackSettings = createSettingsStore({
  storageKey: PLAYBACK_SETTINGS_STORAGE_KEY,
  channelName: PLAYBACK_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_PLAYBACK_SETTINGS,
  normalize: normalizePlaybackSettings
});
