import type { MediaEntity, PlaylistRepeatMode } from '$lib/contracts/catalog';
import type { TrackMetadata } from '$lib/contracts/media-metadata';
import type { PlaybackSnapshot } from '$lib/contracts/playback';
import { projectTrackMetadata } from '$lib/media/track-metadata';
import type {
  MultiplayerPlaybackSnapshot,
  MultiplayerRepeatMode,
  MultiplayerTrack,
  MultiplayerTrackMetadata
} from './multiplayer-protocol';

const MAX_PLAYBACK_SECONDS = 60 * 60 * 24 * 7;

/** Projects an application-owned catalog item onto the protocol's wire DTO. */
export function sanitizeMediaEntity(item: MediaEntity): MultiplayerTrack {
  return {
    id: item.id,
    name: item.name,
    extension: item.format,
    kind: item.kind,
    size: isNonNegativeSafeInteger(item.size) ? item.size : 0,
    lastModified: isFiniteNonNegative(item.lastModified) ? item.lastModified : 0,
    ...(item.path ? { path: item.path } : {}),
    ...(item.metadata ? { metadata: sanitizeTrackMetadata(item.metadata) } : {}),
    ...(isBoundedRating(item.rating) ? { rating: item.rating } : {}),
    ...(isNonNegativeSafeInteger(item.subsong) ? { subsong: item.subsong } : {})
  };
}

export function mediaEntityFromMultiplayerTrack(track: MultiplayerTrack): MediaEntity {
  return {
    id: track.id,
    path: track.name,
    name: track.name,
    format: track.extension,
    kind: track.kind,
    size: track.size,
    lastModified: track.lastModified,
    metadata: track.metadata
  };
}

/** Copies every current metadata field explicitly so future application fields do not leak. */
export function sanitizeTrackMetadata(metadata: TrackMetadata): MultiplayerTrackMetadata {
  return projectTrackMetadata(metadata) ?? {};
}

/** Projects player state without structurally admitting future application-only fields. */
export function projectMultiplayerPlaybackSnapshot(
  snapshot: PlaybackSnapshot
): MultiplayerPlaybackSnapshot {
  return {
    state: snapshot.state,
    currentTime: boundedPlaybackSeconds(snapshot.currentTime),
    duration: boundedPlaybackSeconds(snapshot.duration),
    volume: boundedVolume(snapshot.volume),
    muted: snapshot.muted,
    backend: snapshot.backend,
    ...(isNonNegativeSafeInteger(snapshot.subsong) ? { subsong: snapshot.subsong } : {}),
    ...(isNonNegativeSafeInteger(snapshot.subsongCount)
      ? { subsongCount: snapshot.subsongCount }
      : {}),
    ...(snapshot.buffered
      ? {
          buffered: snapshot.buffered
            .filter(isBufferedRange)
            .map(([start, end]): [number, number] => [start, end])
        }
      : {}),
    ...(typeof snapshot.error === 'string' ? { error: snapshot.error } : {})
  };
}

export function projectMultiplayerRepeatMode(mode: PlaylistRepeatMode): MultiplayerRepeatMode {
  return mode;
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNonNegative(value: number | undefined): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

function isBoundedRating(value: number | undefined): value is number {
  return isFiniteNumber(value) && value >= 0.5 && value <= 5;
}

function boundedPlaybackSeconds(value: number): number {
  if (!isFiniteNonNegative(value)) return 0;
  return Math.min(value, MAX_PLAYBACK_SECONDS);
}

function boundedVolume(value: number): number {
  if (!isFiniteNumber(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function isBufferedRange(range: [number, number]): boolean {
  return Array.isArray(range)
    && range.length === 2
    && isFiniteNonNegative(range[0])
    && range[0] <= MAX_PLAYBACK_SECONDS
    && isFiniteNonNegative(range[1])
    && range[1] >= range[0]
    && range[1] <= MAX_PLAYBACK_SECONDS;
}
