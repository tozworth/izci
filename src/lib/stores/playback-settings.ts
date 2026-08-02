import type {
  PlaybackRestoreMode,
  PlaybackSettings,
  PlaybackTransitionMode,
  ReplayGainMode
} from '$lib/types';
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

export const PLAYBACK_TRANSITION_MODE_OPTIONS: Array<{
  value: PlaybackTransitionMode;
  label: string;
}> = [
  { value: 'none', label: 'None' },
  { value: 'fadeout', label: 'Fade out' },
  { value: 'crossfade', label: 'Crossfade' }
];

export const REMEMBER_PROGRESS_DURATION_MINUTES = [null, 0, 5, 15, 30, 60, 120, 300, 600] as const;
export const DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX = 4;
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2;
export const PLAYBACK_RATE_STEP = 0.05;
export const FADE_DURATION_MIN_SECONDS = 0.5;
export const FADE_DURATION_MAX_SECONDS = 30;
export const FADE_DURATION_STEP_SECONDS = 0.5;
export const MANUAL_TRACK_CHANGE_FADE_PERCENT_MIN = 0;
export const MANUAL_TRACK_CHANGE_FADE_PERCENT_MAX = 100;
export const MANUAL_TRACK_CHANGE_FADE_PERCENT_STEP = 5;

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  playbackRate: 1,
  trueSpeed: false,
  restartCurrentTrackOnPrevious: true,
  transitionMode: 'none',
  gaplessPlayback: true,
  fadeDurationSeconds: 5,
  manualTrackChangeFadePercent: 0,
  logarithmicVolume: true,
  replayGainMode: 'track',
  restoreMode: 'disabled',
  rememberProgressDurationIndex: DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX,
  enableRaf: false,
  showRafToggleInPlayerBar: false
};

export function normalizePlaybackTransitionMode(value: unknown): PlaybackTransitionMode {
  return value === 'none' || value === 'fadeout' || value === 'crossfade'
    ? value
    : DEFAULT_PLAYBACK_SETTINGS.transitionMode;
}

export function normalizeFadeDurationSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PLAYBACK_SETTINGS.fadeDurationSeconds;
  }

  const clamped = Math.min(Math.max(value, FADE_DURATION_MIN_SECONDS), FADE_DURATION_MAX_SECONDS);
  const stepped = Math.round(clamped / FADE_DURATION_STEP_SECONDS) * FADE_DURATION_STEP_SECONDS;
  return Number(stepped.toFixed(1));
}

export function normalizeManualTrackChangeFadePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PLAYBACK_SETTINGS.manualTrackChangeFadePercent;
  }

  const clamped = Math.min(
    Math.max(value, MANUAL_TRACK_CHANGE_FADE_PERCENT_MIN),
    MANUAL_TRACK_CHANGE_FADE_PERCENT_MAX
  );
  return Math.round(clamped / MANUAL_TRACK_CHANGE_FADE_PERCENT_STEP)
    * MANUAL_TRACK_CHANGE_FADE_PERCENT_STEP;
}

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
  const gaplessPlayback =
    typeof source.gaplessPlayback === 'boolean'
      ? source.gaplessPlayback
      : DEFAULT_PLAYBACK_SETTINGS.gaplessPlayback;
  const requestedTransitionMode = normalizePlaybackTransitionMode(source.transitionMode);

  return {
    playbackRate: normalizePlaybackRate(source.playbackRate),
    trueSpeed:
      typeof source.trueSpeed === 'boolean'
        ? source.trueSpeed
        : DEFAULT_PLAYBACK_SETTINGS.trueSpeed,
    restartCurrentTrackOnPrevious:
      typeof source.restartCurrentTrackOnPrevious === 'boolean'
        ? source.restartCurrentTrackOnPrevious
        : DEFAULT_PLAYBACK_SETTINGS.restartCurrentTrackOnPrevious,
    transitionMode:
      !gaplessPlayback && requestedTransitionMode === 'crossfade'
        ? 'fadeout'
        : requestedTransitionMode,
    gaplessPlayback,
    fadeDurationSeconds: normalizeFadeDurationSeconds(source.fadeDurationSeconds),
    manualTrackChangeFadePercent: normalizeManualTrackChangeFadePercent(
      source.manualTrackChangeFadePercent
    ),
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
