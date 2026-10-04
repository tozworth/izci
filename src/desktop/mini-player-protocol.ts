import type { PlaybackSnapshot, TrackItem } from '$lib/types';

export const MINI_PLAYER_STATE_EVENT = 'izci:desktop-mini-state';
export const MINI_PLAYER_REQUEST_EVENT = 'izci:desktop-mini-request';
export const MINI_PLAYER_COMMAND_EVENT = 'izci:desktop-mini-command';
export const MINI_PLAYER_CLOSED_EVENT = 'izci:desktop-mini-closed';

export interface MiniPlayerView {
  snapshot: PlaybackSnapshot;
  track: TrackItem | null;
  selectedTrack: TrackItem | null;
  artworkUrl: string | null;
  patternSeekTimes: readonly number[] | null;
}

export type MiniPlayerCommand =
  | { action: 'togglePlayback' | 'previousTrack' | 'nextTrack' | 'toggleMute' | 'enterNowPlaying' }
  | { action: 'seek' | 'setVolume'; value: number };

const SIMPLE_ACTIONS = new Set(['togglePlayback', 'previousTrack', 'nextTrack', 'toggleMute', 'enterNowPlaying']);

export function parseMiniPlayerCommand(value: unknown): MiniPlayerCommand | null {
  if (!value || typeof value !== 'object') return null;
  const command = value as { action?: unknown; value?: unknown };
  if (typeof command.action !== 'string') return null;
  if (SIMPLE_ACTIONS.has(command.action)) return { action: command.action } as MiniPlayerCommand;
  if (command.action !== 'seek' && command.action !== 'setVolume') return null;
  if (typeof command.value !== 'number' || !Number.isFinite(command.value)) return null;
  if (command.value < 0 || (command.action === 'setVolume' && command.value > 1)) return null;
  return { action: command.action, value: command.value };
}

// Only presentation data crosses windows. Files, handles, and playback nodes stay with the owner.
export function miniPlayerTrackView(track: TrackItem | null): TrackItem | null {
  if (!track) return null;
  return {
    id: track.id,
    name: track.name,
    extension: track.extension,
    kind: track.kind,
    size: track.size,
    lastModified: track.lastModified,
    metadata: { title: track.metadata?.title, artist: track.metadata?.artist }
  };
}
