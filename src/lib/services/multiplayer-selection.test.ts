import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import { resolveMultiplayerPlayingTrackSelection } from './multiplayer-selection';

function item(id: string): TrackItem {
  return {
    id,
    name: `${id}.mp3`,
    path: `${id}.mp3`,
    kind: 'stream',
    extension: 'mp3',
    size: 1,
    lastModified: 1
  };
}

describe('multiplayer playing-track selection', () => {
  const queue = [item('a'), item('b'), item('c')];

  it('selects a newly playing track like local playback does', () => {
    expect(resolveMultiplayerPlayingTrackSelection('a', 'b', queue)).toEqual({
      observedTrackId: 'b',
      selection: { ids: ['b'], anchorId: 'b', focusId: 'b' }
    });
  });

  it('does not replace a manual selection while the same track keeps playing', () => {
    expect(resolveMultiplayerPlayingTrackSelection('b', 'b', queue)).toEqual({
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
    expect(resolveMultiplayerPlayingTrackSelection('b', null, queue)).toEqual({
      observedTrackId: null,
      selection: null
    });
  });
});
