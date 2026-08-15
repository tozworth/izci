import type { TrackItem, TrackSelection } from '$lib/types';

export interface MultiplayerPlayingTrackSelectionSync {
  observedTrackId: string | null;
  selection: TrackSelection | null;
}

export function resolveMultiplayerPlayingTrackSelection(
  observedTrackId: string | null,
  playingTrackId: string | null,
  queueItems: TrackItem[]
): MultiplayerPlayingTrackSelectionSync {
  if (!playingTrackId) {
    return { observedTrackId: null, selection: null };
  }

  if (playingTrackId === observedTrackId) {
    return { observedTrackId, selection: null };
  }

  if (!queueItems.some((item) => item.id === playingTrackId)) {
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
