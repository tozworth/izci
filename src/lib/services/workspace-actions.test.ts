import { describe, expect, it } from 'vitest';

import {
  buildLibraryContextActions,
  buildPlaylistContextActions,
  buildSelectedWorkspaceTracks,
  getEquivalentLibraryIds,
  getEquivalentFavoriteIds,
  getOtherWorkspaceCollection,
  favoritesHaveAllTracks,
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

    expect(
      buildPlaylistContextActions(playlistTracks, libraryTracks, ['playlist-alpha']).map((action) => action.id)
    ).not.toContain('track-lyrics');
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

  it('matches favorites by file identity and subsong', () => {
    const base = item('module', { path: '/Music/Module.xm', kind: 'module', extension: 'xm' });
    const first = { ...base, id: 'first', subsong: 0 };
    const second = { ...base, id: 'second', subsong: 1 };
    const favorite = { ...first, id: 'favorite-first' };

    expect(favoritesHaveAllTracks([favorite], [first])).toBe(true);
    expect(favoritesHaveAllTracks([favorite], [second])).toBe(false);
    expect(favoritesHaveAllTracks([favorite], [base])).toBe(false);
    expect(getEquivalentFavoriteIds([favorite], [first])).toEqual(['favorite-first']);
  });

  it('offers a favorite toggle in track context menus', () => {
    const track = item('track', { path: '/Music/Track.flac' });
    const favorite = { ...track, id: 'favorite' };

    expect(buildPlaylistContextActions([track], [], ['track'], [favorite]))
      .toContainEqual(expect.objectContaining({ id: 'toggle-favorite', label: 'Remove from favorites' }));
    expect(buildLibraryContextActions([track], [], ['track']))
      .toContainEqual(expect.objectContaining({ id: 'toggle-favorite', label: 'Add to favorites' }));
  });

  it('offers subsong separation only for one unsplit multi-subsong module', () => {
    const module = item('module', {
      extension: 'xm',
      kind: 'module',
      metadata: { subsongs: 3 }
    });

    expect(buildPlaylistContextActions([module], [], ['module']).map((action) => action.id))
      .toContain('separate-subsongs');
    expect(buildPlaylistContextActions([{ ...module, subsong: 0 }], [], ['module']).map((action) => action.id))
      .not.toContain('separate-subsongs');
    expect(buildPlaylistContextActions([module, item('other')], [], ['module', 'other']).map((action) => action.id))
      .not.toContain('separate-subsongs');
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
