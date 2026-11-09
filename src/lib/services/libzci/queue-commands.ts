import type { RepeatMode, TrackItem } from '$lib/types';
import type { CoreSourceReference } from './queue-snapshot';

/**
 * Svelte-side builder/validation boundary for the shared core queue.
 *
 * The Rust owner (`libzci::queue::QueueCommand`, `libzci::profile::Profile`)
 * remains the only queue authority. This module pins the JSON contract the
 * future Svelte owner worker will post to `WebProfile.request()` and maps
 * Svelte `TrackItem`s to core `SourceReference`s without persisting handles,
 * blobs, or URLs. Nothing here writes storage or owns playback.
 *
 * JSON shapes mirror `libzci/consumers/crude-pwa/src/profile-types.ts` and the
 * Rust `#[serde(tag = "kind", rename_all = "snake_case")]` envelope. Keep them
 * in sync; the unit tests pin the wire names.
 */

export const CORE_MAX_QUEUE = 10_000;
export const CORE_MAX_SOURCE_TEXT = 8_192;
export const CORE_MAX_REQUEST = 256;
export const CORE_MAX_APPEND_BATCH = 10_000;

export type CoreRepeat = 'off' | 'all' | 'one';
export type CoreReplayGainMode = 'off' | 'track' | 'album';

export interface CoreReplayGainSettings {
  mode: CoreReplayGainMode;
  fallback: boolean;
  preamp_db: number;
  missing_gain_db: number;
  r128_target_lufs: number;
  prevent_clipping: boolean;
}

export interface CorePlayCountSettings {
  enabled: boolean;
  threshold_seconds: number;
}

export interface CoreQueueSettings {
  shuffle: boolean;
  repeat: CoreRepeat;
  previous_restart_seconds: number;
  volume: number;
  mute: boolean;
  replay_gain: CoreReplayGainSettings;
  play_counts: CorePlayCountSettings;
}

export type CoreQueueCommand =
  | { kind: 'volume'; volume: number }
  | { kind: 'mute'; mute: boolean }
  | { kind: 'append'; sources: CoreSourceReference[] }
  | { kind: 'remove'; id: number }
  | { kind: 'play'; id: number }
  | { kind: 'up_next'; id: number }
  | { kind: 'move'; id: number; index: number }
  | { kind: 'next'; ended: boolean }
  | { kind: 'previous'; position_seconds: number }
  | { kind: 'clear_up_next' }
  | { kind: 'settings'; settings: CoreQueueSettings }
  | { kind: 'checkpoint'; position_seconds: number; subsong: number | null };

function isNonEmptyBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= CORE_MAX_SOURCE_TEXT &&
    !value.includes('\0')
  );
}

function isValidOccurrenceId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 9_007_199_254_740_991
  );
}

/** Mirror of `libzci::queue::SourceReference::validate`. */
export function validateSourceReference(source: CoreSourceReference): void {
  if (
    !isNonEmptyBoundedText(source.key) ||
    !isNonEmptyBoundedText(source.locator) ||
    !isNonEmptyBoundedText(source.display_path)
  ) {
    throw new Error('Invalid source reference: key/locator/display_path must be 1..8192 chars');
  }
  if (source.kind !== 'native_path' && source.kind !== 'browser_handle' && source.kind !== 'ephemeral') {
    throw new Error(`Invalid source kind: ${String(source.kind)}`);
  }
}

/**
 * Classify a Svelte track for the core reference table.
 *
 * - `native_path`: desktop/Android disk-backed reference (`nativeFile.uri`).
 * - `browser_handle`: File System Access handle (restorable via capabilities).
 * - `ephemeral`: plain `File` with no restorable handle (non-restorable).
 *
 * The locator for `native_path` is the native URI. For browser handles the
 * future owner worker replaces this transitional locator with the real
 * capability-registry key; today it equals the reference key so rows stay
 * visible without inventing handle serialization.
 */
export function sourceKindForTrack(track: TrackItem): CoreSourceReference['kind'] {
  if (track.nativeFile?.uri) return 'native_path';
  if (track.fileHandle) return 'browser_handle';
  return 'ephemeral';
}

/**
 * Build the core `SourceReference` for one Svelte track.
 *
 * Handles, blobs and object URLs never enter the reference. `key` defaults to
 * `svelte/<track.id>`; callers staging a batch pass a shared request prefix
 * (`<uuid>/<index>`) to match the crude `stage()` key scheme.
 */
export function sourceReferenceForTrack(track: TrackItem, key?: string): CoreSourceReference {
  const referenceKey = key ?? `svelte/${track.id}`;
  const kind = sourceKindForTrack(track);
  const locator = kind === 'native_path' ? track.nativeFile!.uri : referenceKey;
  const display_path = track.path ?? track.name;
  const reference: CoreSourceReference = { key: referenceKey, kind, locator, display_path };
  validateSourceReference(reference);
  return reference;
}

/** Map the Svelte repeat mode to the core `Repeat` vocabulary (identical names). */
export function coreRepeatForMode(mode: RepeatMode): CoreRepeat {
  if (mode !== 'off' && mode !== 'all' && mode !== 'one') {
    throw new Error(`Invalid repeat mode: ${String(mode)}`);
  }
  return mode;
}

export interface SvelteQueueSettingsInput {
  shuffle: boolean;
  repeatMode: RepeatMode;
  previousRestartSeconds: number;
  volume: number;
  mute: boolean;
  replayGainMode: CoreReplayGainMode;
  replayGainPreampDb: number;
  playCountEnabled: boolean;
  playCountThresholdSeconds: number;
}

/**
 * Map Svelte playback/volume/metadata settings to the core settings row.
 * Mirrors `QueueSettings::validate` plus the replay-gain/play-count defaults
 * used by both crudes (`fallback: true`, `r128_target_lufs: -18`,
 * `prevent_clipping: true`, threshold `1..3600`).
 */
export function coreQueueSettingsForInput(input: SvelteQueueSettingsInput): CoreQueueSettings {
  const previous_restart_seconds = Number(input.previousRestartSeconds);
  if (!Number.isFinite(previous_restart_seconds) || previous_restart_seconds < 0 || previous_restart_seconds > 600) {
    throw new Error('Invalid previous_restart_seconds: expected 0..600');
  }
  if (!Number.isFinite(input.volume) || input.volume < 0 || input.volume > 1) {
    throw new Error('Invalid volume: expected 0..1');
  }
  if (input.replayGainMode !== 'off' && input.replayGainMode !== 'track' && input.replayGainMode !== 'album') {
    throw new Error(`Invalid replayGainMode: ${String(input.replayGainMode)}`);
  }
  if (!Number.isFinite(input.replayGainPreampDb) || input.replayGainPreampDb < -12 || input.replayGainPreampDb > 12) {
    throw new Error('Invalid replayGainPreampDb: expected -12..12');
  }
  const threshold_seconds = Math.round(Number(input.playCountThresholdSeconds));
  if (!Number.isSafeInteger(threshold_seconds) || threshold_seconds < 1 || threshold_seconds > 3600) {
    throw new Error('Invalid playCountThresholdSeconds: expected 1..3600');
  }
  return {
    shuffle: input.shuffle === true,
    repeat: coreRepeatForMode(input.repeatMode),
    previous_restart_seconds,
    volume: input.volume,
    mute: input.mute === true,
    replay_gain: {
      mode: input.replayGainMode,
      fallback: true,
      preamp_db: input.replayGainPreampDb,
      missing_gain_db: 0,
      r128_target_lufs: -18,
      prevent_clipping: true
    },
    play_counts: {
      enabled: input.playCountEnabled === true,
      threshold_seconds
    }
  };
}

export function buildAppendCommand(tracks: TrackItem[], keyPrefix?: string): CoreQueueCommand {
  if (tracks.length === 0 || tracks.length > CORE_MAX_APPEND_BATCH) {
    throw new Error(`Invalid append batch: expected 1..${CORE_MAX_APPEND_BATCH} tracks`);
  }
  const sources = tracks.map((track, index) =>
    sourceReferenceForTrack(track, keyPrefix ? `${keyPrefix}/${index}` : undefined)
  );
  if (sources.length > CORE_MAX_QUEUE) {
    throw new Error('Invalid append batch: exceeds core queue bound');
  }
  return { kind: 'append', sources };
}

export function buildPlayCommand(occurrenceId: number): CoreQueueCommand {
  if (!isValidOccurrenceId(occurrenceId)) throw new Error(`Invalid occurrence id: ${String(occurrenceId)}`);
  return { kind: 'play', id: occurrenceId };
}

export function buildRemoveCommand(occurrenceId: number): CoreQueueCommand {
  if (!isValidOccurrenceId(occurrenceId)) throw new Error(`Invalid occurrence id: ${String(occurrenceId)}`);
  return { kind: 'remove', id: occurrenceId };
}

export function buildMoveCommand(occurrenceId: number, index: number): CoreQueueCommand {
  if (!isValidOccurrenceId(occurrenceId)) throw new Error(`Invalid occurrence id: ${String(occurrenceId)}`);
  if (!Number.isSafeInteger(index) || index < 0 || index >= CORE_MAX_QUEUE) {
    throw new Error(`Invalid move index: ${String(index)}`);
  }
  return { kind: 'move', id: occurrenceId, index };
}

export function buildUpNextCommand(occurrenceId: number): CoreQueueCommand {
  if (!isValidOccurrenceId(occurrenceId)) throw new Error(`Invalid occurrence id: ${String(occurrenceId)}`);
  return { kind: 'up_next', id: occurrenceId };
}

export function buildNextCommand(ended: boolean): CoreQueueCommand {
  return { kind: 'next', ended: ended === true };
}

export function buildPreviousCommand(positionSeconds: number): CoreQueueCommand {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 1_000_000_000) {
    throw new Error(`Invalid position_seconds: ${String(positionSeconds)}`);
  }
  return { kind: 'previous', position_seconds: positionSeconds };
}

export function buildClearUpNextCommand(): CoreQueueCommand {
  return { kind: 'clear_up_next' };
}

export function buildSettingsCommand(settings: CoreQueueSettings): CoreQueueCommand {
  // Reuse the same bounds as the settings mapper so malformed rows fail fast
  // on the Svelte side before reaching the owner worker.
  coreQueueSettingsForInput({
    shuffle: settings.shuffle,
    repeatMode: settings.repeat,
    previousRestartSeconds: settings.previous_restart_seconds,
    volume: settings.volume,
    mute: settings.mute,
    replayGainMode: settings.replay_gain.mode,
    replayGainPreampDb: settings.replay_gain.preamp_db,
    playCountEnabled: settings.play_counts.enabled,
    playCountThresholdSeconds: settings.play_counts.threshold_seconds
  });
  return { kind: 'settings', settings };
}

export function buildCheckpointCommand(
  positionSeconds: number,
  subsong: number | null
): CoreQueueCommand {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 1_000_000_000) {
    throw new Error(`Invalid position_seconds: ${String(positionSeconds)}`);
  }
  if (subsong !== null && (!Number.isSafeInteger(subsong) || subsong < 0 || subsong > 4_294_967_295)) {
    throw new Error(`Invalid subsong: ${String(subsong)}`);
  }
  return { kind: 'checkpoint', position_seconds: positionSeconds, subsong };
}

export function buildVolumeCommand(volume: number): CoreQueueCommand {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error(`Invalid volume: ${String(volume)}`);
  }
  return { kind: 'volume', volume };
}

export function buildMuteCommand(mute: boolean): CoreQueueCommand {
  return { kind: 'mute', mute: mute === true };
}

/**
 * Durable request identity for `WebProfile.request(command, request)`.
 * Mirrors the crude `${uuid}/${scope}` scheme. The core treats ids without a
 * `base:` prefix as fresh mutations and rejects replayed payloads; ids must
 * stay non-empty and within 256 chars. Age-gated `base:revision` ids remain
 * the caller's responsibility.
 */
export function makeQueueRequestId(scope = 'queue'): string {
  const id = `${crypto.randomUUID()}/${scope}`;
  validateQueueRequestId(id);
  return id;
}

export function validateQueueRequestId(request: string): void {
  if (!request || request.length > CORE_MAX_REQUEST) {
    throw new Error('Invalid queue request id: expected 1..256 chars');
  }
}

/** Serialize a command for the owner-worker `request` channel (16 MiB cap lives in core). */
export function serializeQueueCommand(command: CoreQueueCommand): string {
  return JSON.stringify(command);
}
