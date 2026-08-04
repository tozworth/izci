import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import { resolveMultiplayerPlayingTrackSelection } from './multiplayer-selection';

function item(id: string): PlaylistItem {
  return {
    id,
    name: `${id}.mp3`,
    path: `${id}.mp3`,
    kind: 'stream'
  };
}

describe('multiplayer playing-track selection', () => {
  const playlist = [item('a'), item('b'), item('c')];

  it('selects a newly playing track like local playback does', () => {
    expect(resolveMultiplayerPlayingTrackSelection('a', 'b', playlist)).toEqual({
      observedTrackId: 'b',
      selection: { ids: ['b'], anchorId: 'b', focusId: 'b' }
    });
  });

  it('does not replace a manual selection while the same track keeps playing', () => {
    expect(resolveMultiplayerPlayingTrackSelection('b', 'b', playlist)).toEqual({
      observedTrackId: 'b',
      selection: null
    });
  });

  it('waits for the matching catalog revision before marking the track observed', () => {
    expect(resolveMultiplayerPlayingTrackSelection('a', 'b', [item('a')])).toEqual({
      observedTrackId: 'a',
      selection: null
    });
  });

  it('allows the same track to auto-select after playback was cleared', () => {
    expect(resolveMultiplayerPlayingTrackSelection('b', null, playlist)).toEqual({
      observedTrackId: null,
      selection: null
    });
  });
});
