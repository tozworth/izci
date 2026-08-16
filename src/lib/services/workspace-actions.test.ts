import { describe, expect, it } from 'vitest';

import {
  buildFavoritesContextActions,
  buildFreeplayLibraryContextActions,
  buildFreeplayQueueContextActions,
  buildLibraryContextActions,
  buildLibraryGroupContextActions,
  buildQueueContextActions,
  buildSelectedWorkspaceTracks,
  getEquivalentLibraryIds,
  getEquivalentFavoriteIds,
  getOtherWorkspaceCollection,
  favoritesHaveAllTracks,
  libraryHasAllTracks,
  resolveTrackLibraryNavigationAction
} from './workspace-actions';
import type { TrackItem } from '$lib/types';

function item(id: string, overrides: Partial<TrackItem> = {}): TrackItem {
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

    expect(getOtherWorkspaceCollection('queue')).toBe('library');
    expect(getOtherWorkspaceCollection('library')).toBe('queue');
    expect(buildSelectedWorkspaceTracks(tracks, ['c', 'a']).map((track) => track.id)).toEqual(['a', 'c']);
  });

  it('keeps Freeplay queue actions local and excludes host mutations', () => {
    const track = item('track', { path: '/Music/Track.flac', metadata: { artist: 'Artist' } });
    expect(buildFreeplayQueueContextActions([track], [track], ['track']).map(({ id }) => id))
      .toEqual(['go-to-library', 'track-details', 'remove']);
    expect(buildFreeplayLibraryContextActions([track], [track], ['track']).map(({ id }) => id))
      .toEqual(['add-to-queue', 'replace-queue', 'go-to-library', 'track-details']);
  });

  it('matches queue tracks to library rows by stable track identity', () => {
    const queueTracks = [
      item('queue-alpha', { path: '/Music/Alpha.flac' }),
      item('queue-beta', { path: '/Music/Beta.flac' })
    ];
    const libraryTracks = [
      item('library-alpha', { path: '/music/alpha.flac' }),
      item('library-gamma', { path: '/Music/Gamma.flac' })
    ];

    expect(libraryHasAllTracks(libraryTracks, [queueTracks[0]])).toBe(true);
    expect(libraryHasAllTracks(libraryTracks, queueTracks)).toBe(false);
    expect(getEquivalentLibraryIds(libraryTracks, queueTracks)).toEqual(['library-alpha']);
  });

  it('changes queue library action labels based on membership', () => {
    const queueTracks = [item('queue-alpha', { path: '/Music/Alpha.flac' })];
    const libraryTracks = [item('library-alpha', { path: '/music/alpha.flac' })];

    expect(
      buildQueueContextActions(queueTracks, libraryTracks, ['queue-alpha']).map((action) => action.id)
    ).not.toContain('track-lyrics');
    expect(buildQueueContextActions(queueTracks, libraryTracks, ['queue-alpha'])
      .find((action) => action.id === 'toggle-library')).toMatchObject({
      id: 'toggle-library',
      label: 'Remove from library',
      icon: 'remove_circle'
    });
    expect(buildQueueContextActions(queueTracks, [], ['queue-alpha'])
      .find((action) => action.id === 'toggle-library')).toMatchObject({
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

    expect(buildQueueContextActions([track], [], ['track'], [favorite]))
      .toContainEqual(expect.objectContaining({ id: 'toggle-favorite', label: 'Remove from favorites' }));
    expect(buildLibraryContextActions([track], [], ['track']))
      .toContainEqual(expect.objectContaining({ id: 'toggle-favorite', label: 'Add to favorites' }));
  });

  it('offers ten half-star ratings only when ratings are enabled', () => {
    const track = item('track', { rating: 4 });
    const enabled = buildQueueContextActions([track], [], ['track'], [], true);
    const disabled = buildQueueContextActions([track], [], ['track'], [], false);
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
    const queueTrack = { ...libraryTrack, id: 'queue' };
    const queueActions = buildQueueContextActions(
      [queueTrack],
      [libraryTrack],
      ['queue']
    );
    const goToIndex = queueActions.findIndex((action) => action.id === 'go-to-library');

    expect(goToIndex).toBeGreaterThanOrEqual(0);
    expect(queueActions[goToIndex + 1]?.id).toBe('track-details');
    expect(queueActions[goToIndex].children?.map((action) => action.id)).toEqual([
      'go-to-library-artist',
      'go-to-library-album',
      'go-to-library-genre',
      'go-to-library-year',
      'go-to-library-format'
    ]);
    expect(resolveTrackLibraryNavigationAction(
      'go-to-library-album',
      queueTrack,
      [libraryTrack]
    )).toMatchObject({ view: 'albums', trackId: 'library' });

    const favoriteActions = buildFavoritesContextActions(
      [{ ...queueTrack, id: 'favorite' }],
      [libraryTrack],
      ['favorite']
    );
    expect(favoriteActions.findIndex((action) => action.id === 'go-to-library') + 1)
      .toBe(favoriteActions.findIndex((action) => action.id === 'track-details'));
  });

  it('omits the Go to submenu for multi-track selections and tracks outside the library', () => {
    const first = item('first', { path: '/Music/First.flac' });
    const second = item('second', { path: '/Music/Second.flac' });

    expect(buildQueueContextActions([first], [], ['first']).map((action) => action.id))
      .not.toContain('go-to-library');
    expect(buildLibraryContextActions([first, second], [], ['first', 'second']).map((action) => action.id))
      .not.toContain('go-to-library');
  });

  it('offers subsong separation only for one unsplit multi-subsong module', () => {
    const module = item('module', {
      extension: 'xm',
      kind: 'module',
      metadata: { subsongs: 3 }
    });

    expect(buildQueueContextActions([module], [], ['module']).map((action) => action.id))
      .toContain('separate-subsongs');
    expect(buildQueueContextActions([{ ...module, subsong: 0 }], [], ['module']).map((action) => action.id))
      .not.toContain('separate-subsongs');
    expect(buildQueueContextActions([module, item('other')], [], ['module', 'other']).map((action) => action.id))
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
    const flatActions = buildLibraryContextActions([item('one'), item('two')], [], ['one', 'two']);
    const groupedActions = buildLibraryGroupContextActions(flatActions);

    expect(flatActions.map((action) => action.id)).not.toContain('shuffle-play');
    expect(groupedActions.map((action) => action.id)).toEqual([
      'add-to-queue',
      'replace-queue',
      'shuffle-play',
      'play-next',
      'track-details',
      'copy-filename',
      'toggle-favorite',
      'rate',
      'reset-play-count',
      'remove'
    ]);
  });
});
