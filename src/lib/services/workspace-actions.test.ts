import { describe, expect, it } from 'vitest';

import {
  buildLibraryContextActions,
  buildPlaylistContextActions,
  buildSelectedWorkspaceTracks,
  getEquivalentLibraryIds,
  getOtherWorkspaceCollection,
  libraryHasAllTracks
} from './workspace-actions';
import type { PlaylistItem } from '$lib/types';

function item(id: string, overrides: Partial<PlaylistItem> = {}): PlaylistItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    ...overrides
  };
}

describe('workspace actions', () => {
  it('builds selected tracks in collection order and flips collection ids', () => {
    const tracks = [item('a'), item('b'), item('c')];

    expect(getOtherWorkspaceCollection('playlist')).toBe('library');
    expect(getOtherWorkspaceCollection('library')).toBe('playlist');
    expect(buildSelectedWorkspaceTracks(tracks, ['c', 'a']).map((track) => track.id)).toEqual(['a', 'c']);
  });

  it('matches playlist tracks to library rows by stable track identity', () => {
    const playlistTracks = [
      item('playlist-alpha', { path: '/Music/Alpha.flac' }),
      item('playlist-beta', { path: '/Music/Beta.flac' })
    ];
    const libraryTracks = [
      item('library-alpha', { path: '/music/alpha.flac' }),
      item('library-gamma', { path: '/Music/Gamma.flac' })
    ];

    expect(libraryHasAllTracks(libraryTracks, [playlistTracks[0]])).toBe(true);
    expect(libraryHasAllTracks(libraryTracks, playlistTracks)).toBe(false);
    expect(getEquivalentLibraryIds(libraryTracks, playlistTracks)).toEqual(['library-alpha']);
  });

  it('changes playlist library action labels based on membership', () => {
    const playlistTracks = [item('playlist-alpha', { path: '/Music/Alpha.flac' })];
    const libraryTracks = [item('library-alpha', { path: '/music/alpha.flac' })];

    expect(buildPlaylistContextActions(playlistTracks, libraryTracks, ['playlist-alpha'])[1]).toMatchObject({
      id: 'toggle-library',
      label: 'Remove from library',
      icon: 'remove_circle'
    });
    expect(buildPlaylistContextActions(playlistTracks, [], ['playlist-alpha'])[1]).toMatchObject({
      id: 'toggle-library',
      label: 'Add to library',
      icon: 'library_add'
    });
  });

  it('includes reset play count in library context actions', () => {
    expect(buildLibraryContextActions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'reset-play-count',
          label: 'Reset play count',
          icon: 'restart_alt'
        })
      ])
    );
  });
});
