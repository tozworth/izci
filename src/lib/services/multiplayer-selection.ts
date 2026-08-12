import type { PlaylistItem, PlaylistSelection } from '$lib/contracts/catalog';

export interface MultiplayerPlayingTrackSelectionSync {
  observedTrackId: string | null;
  selection: PlaylistSelection | null;
}

export function resolveMultiplayerPlayingTrackSelection(
  observedTrackId: string | null,
  playingTrackId: string | null,
  playlistItems: PlaylistItem[]
): MultiplayerPlayingTrackSelectionSync {
  if (!playingTrackId) {
    return { observedTrackId: null, selection: null };
  }

  if (playingTrackId === observedTrackId) {
    return { observedTrackId, selection: null };
  }

  if (!playlistItems.some((item) => item.id === playingTrackId)) {
    return { observedTrackId, selection: null };
  }

  return {
    observedTrackId: playingTrackId,
    selection: {
      ids: [playingTrackId],
      anchorId: playingTrackId,
      focusId: playingTrackId
    }
  };
}
