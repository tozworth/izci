import { PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS } from '$lib/services/playback-commands';
import type { PlaybackOptions, RepeatMode } from '$lib/types';
import { coreQueueSettingsForInput, type CoreQueueSettings } from './queue-commands';

/**
 * Map Svelte store snapshots to the core queue settings row.
 *
 * Core `QueueSettings` is the durable settings authority
 * (`Profile.request({kind:'settings',settings})`); Svelte stores stay
 * observation/binding facades after adoption. This helper is the forward
 * (Svelte → core) direction used when issuing `settings` commands. The
 * reverse (core → Svelte) observation path belongs to the future owner-worker
 * snapshot binding.
 *
 * Transitional notes:
 * - Svelte gates Previous-restart with a boolean plus a 3 s constant, while
 *   core stores seconds (`0..600`). Enabled maps to 3 s; disabled maps to
 *   600 s (effectively never for typical tracks). Svelte keeps its own gate
 *   until Previous decisions move to core.
 * - Svelte mute is transient controller state (not persisted); it is passed
 *   through explicitly, defaulting to `false`.
 * - Svelte play counts have no enabled flag (always count library plays);
 *   core `enabled` is therefore always `true` here with the threshold from
 *   metadata settings.
 */

export interface SvelteSettingsSnapshot {
  queuePlaybackOptions: PlaybackOptions;
  restartCurrentTrackOnPrevious: boolean;
  volume: number;
  mute?: boolean;
  replayGainMode: 'off' | 'track' | 'album';
  replayGainPreampDb: number;
  playCountThresholdSeconds: number;
}

export function svelteSettingsToCore(input: SvelteSettingsSnapshot): CoreQueueSettings {
  const repeatMode: RepeatMode =
    input.queuePlaybackOptions.repeatMode === 'off' ||
    input.queuePlaybackOptions.repeatMode === 'all' ||
    input.queuePlaybackOptions.repeatMode === 'one'
      ? input.queuePlaybackOptions.repeatMode
      : 'off';
  return coreQueueSettingsForInput({
    shuffle: input.queuePlaybackOptions.shuffle === true,
    repeatMode,
    previousRestartSeconds: input.restartCurrentTrackOnPrevious
      ? PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS
      : 600,
    volume: input.volume,
    mute: input.mute === true,
    replayGainMode: input.replayGainMode,
    replayGainPreampDb: input.replayGainPreampDb,
    playCountEnabled: true,
    playCountThresholdSeconds: input.playCountThresholdSeconds
  });
}
