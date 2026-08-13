import { describe, expect, it } from 'vitest';

import {
  buildFavoritesContextActions,
  buildFreeplayLibraryContextActions,
  buildFreeplayPlaylistContextActions,
  buildLibraryContextActions,
  buildLibraryGroupContextActions,
  buildPlaylistContextActions,
  buildSelectedWorkspaceTracks,
  getEquivalentLibraryIds,
  getEquivalentFavoriteIds,
  getOtherWorkspaceCollection,
  favoritesHaveAllTracks,
  libraryHasAllTracks,
  resolveTrackLibraryNavigationAction
} from './workspace-actions';
import type { MediaEntity } from '$lib/contracts/catalog';

function item(id: string, overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id,
    path: 'test',
    name: `${id}.flac`,
    format: 'flac',
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

  it('keeps Freeplay queue actions local and excludes host mutations', () => {
    const track = item('track', { path: '/Music/Track.flac', metadata: { artist: 'Artist' } });
    expect(buildFreeplayPlaylistContextActions([track], [track], ['track']).map(({ id }) => id))
      .toEqual(['go-to-library', 'track-details', 'remove']);
    expect(buildFreeplayLibraryContextActions([track], [track], ['track']).map(({ id }) => id))
      .toEqual(['add-to-playlist', 'replace-playlist', 'go-to-library', 'track-details']);
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
    expect(buildPlaylistContextActions(playlistTracks, libraryTracks, ['playlist-alpha'])
      .find((action) => action.id === 'toggle-library')).toMatchObject({
      id: 'toggle-library',
      label: 'Remove from library',
      icon: 'remove_circle'
    });
    expect(buildPlaylistContextActions(playlistTracks, [], ['playlist-alpha'])
      .find((action) => action.id === 'toggle-library')).toMatchObject({
      id: 'toggle-library',
      label: 'Add to library',
      icon: 'library_add'
    });
  });

  it('matches favorites by file identity and subsong', () => {
    const base = item('module', { path: '/Music/Module.xm', kind: 'module', format: 'xm' });
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

  it('offers ten half-star ratings only when ratings are enabled', () => {
    const track = item('track', { rating: 4 });
    const enabled = buildPlaylistContextActions([track], [], ['track'], [], true);
    const disabled = buildPlaylistContextActions([track], [], ['track'], [], false);
    const ratingAction = enabled.find((action) => action.id === 'rate');

    expect(ratingAction?.ratingPicker).toEqual({ value: 4, actionPrefix: 'rate:' });
    expect(disabled.map((action) => action.id)).not.toContain('rate');
  });

  it('places a destination-aware Go to submenu directly above Track details for one track', () => {
    const libraryTrack = item('library', {
      path: '/Music/Track.flac',
      metadata: {
        artist: 'Artist',
        album: 'Album',
        genre: 'Rock; Electronic',
        year: '2024'
      }
    });
    const playlistTrack = { ...libraryTrack, id: 'playlist' };
    const playlistActions = buildPlaylistContextActions(
      [playlistTrack],
      [libraryTrack],
      ['playlist']
    );
    const goToIndex = playlistActions.findIndex((action) => action.id === 'go-to-library');

    expect(goToIndex).toBeGreaterThanOrEqual(0);
    expect(playlistActions[goToIndex + 1]?.id).toBe('track-details');
    expect(playlistActions[goToIndex].children?.map((action) => action.id)).toEqual([
      'go-to-library-artist',
      'go-to-library-album',
      'go-to-library-genre',
      'go-to-library-year',
      'go-to-library-format'
    ]);
    expect(resolveTrackLibraryNavigationAction(
      'go-to-library-album',
      playlistTrack,
      [libraryTrack]
    )).toMatchObject({ view: 'albums', trackId: 'library' });

    const favoriteActions = buildFavoritesContextActions(
      [{ ...playlistTrack, id: 'favorite' }],
      [libraryTrack],
      ['favorite']
    );
    expect(favoriteActions.findIndex((action) => action.id === 'go-to-library') + 1)
      .toBe(favoriteActions.findIndex((action) => action.id === 'track-details'));
  });

  it('omits the Go to submenu for multi-track selections and tracks outside the library', () => {
    const first = item('first', { path: '/Music/First.flac' });
    const second = item('second', { path: '/Music/Second.flac' });

    expect(buildPlaylistContextActions([first], [], ['first']).map((action) => action.id))
      .not.toContain('go-to-library');
    expect(buildLibraryContextActions([first, second], [], ['first', 'second']).map((action) => action.id))
      .not.toContain('go-to-library');
  });

  it('offers subsong separation only for one unsplit multi-subsong module', () => {
    const module = item('module', {
      format: 'xm',
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

  it('adds shuffle play only when library actions are adapted for a grouped category', () => {
    const flatActions = buildLibraryContextActions([item('track')], [], ['track']);
    const groupedActions = buildLibraryGroupContextActions(flatActions);

    expect(flatActions.map((action) => action.id)).not.toContain('shuffle-play');
    expect(groupedActions.map((action) => action.id)).toEqual([
      'add-to-playlist',
      'replace-playlist',
      'shuffle-play',
      'track-details',
      'toggle-favorite',
      'rate',
      'reset-play-count',
      'remove'
    ]);
  });
});
