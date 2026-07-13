import type { PlaybackRestoreMode, PlaybackSettings, ReplayGainMode } from '$lib/types';
import { createPersistentStore } from './persistent-store';

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

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  logarithmicVolume: true,
  replayGainMode: 'track',
  restoreMode: 'disabled',
  enableRaf: false
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

function normalizeSettings(value: unknown): PlaybackSettings {
  const source = value && typeof value === 'object' ? (value as Partial<PlaybackSettings>) : {};

  return {
    logarithmicVolume:
      typeof source.logarithmicVolume === 'boolean'
        ? source.logarithmicVolume
        : DEFAULT_PLAYBACK_SETTINGS.logarithmicVolume,
    replayGainMode: normalizeReplayGainMode(source.replayGainMode),
    restoreMode: normalizePlaybackRestoreMode(source.restoreMode),
    enableRaf:
      typeof source.enableRaf === 'boolean' ? source.enableRaf : DEFAULT_PLAYBACK_SETTINGS.enableRaf
  };
}

const store = createPersistentStore({
  storageKey: PLAYBACK_SETTINGS_STORAGE_KEY,
  channelName: PLAYBACK_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_PLAYBACK_SETTINGS,
  normalize: normalizeSettings
});

export const playbackSettings = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  update(patch: Partial<PlaybackSettings>): PlaybackSettings {
    return store.update((settings) => ({ ...settings, ...patch }));
  },
  reset: store.reset
};
