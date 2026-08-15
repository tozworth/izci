import { beforeEach, describe, expect, it } from 'vitest';
import {
  LIBRARY_COLUMN_DEFAULT_WIDTHS,
  LIBRARY_VIEW_IDS,
  libraryViewSettings
} from './library-view-settings';

describe('library view settings', () => {
  beforeEach(() => {
    libraryViewSettings.reset();
  });

  it('provides context-aware column defaults for grouped views', () => {
    const views = libraryViewSettings.getSnapshot().views;

    for (const [viewId, view] of Object.entries(views)) {
      expect(view.columns.folder.visible).toBe(false);
      expect(view.columns.format.visible).toBe(viewId === 'ratings');
      expect(view.columns.discAndTrack.visible).toBe(false);
      expect(view.columns.rating.visible).toBe(viewId === 'ratings');
      expect(view.columns.lastPlayed.visible).toBe(false);
      expect(view.columns.plays.visible).toBe(false);
    }

    expect(views.songs.columns.artist.visible).toBe(true);
    expect(views.favorites.columns.artist.visible).toBe(true);
    expect(views.artists.columns.artist.visible).toBe(false);
    expect(views.artists.columns.album.visible).toBe(true);
    expect(views.albums.columns.album.visible).toBe(false);
    expect(views.ratings.order.slice(0, 5)).toEqual(['rating', 'title', 'artist', 'format', 'duration']);
    expect(views.ratings.sort).toEqual({ columnId: 'rating', direction: 'desc' });
    expect(views.ratings.order.filter((id) => views.ratings.columns[id].visible))
      .toEqual(['rating', 'title', 'artist', 'format', 'duration']);
  });

  it('allows optional columns to be restored per view', () => {
    libraryViewSettings.setColumnVisibility('folder', true);
    libraryViewSettings.setColumnVisibility('format', true);
    libraryViewSettings.setColumnVisibility('discAndTrack', true);
    libraryViewSettings.setColumnVisibility('rating', true);

    const songs = libraryViewSettings.getSnapshot().views.songs;
    expect(songs.columns.folder.visible).toBe(true);
    expect(songs.columns.format.visible).toBe(true);
    expect(songs.columns.discAndTrack.visible).toBe(true);
    expect(songs.columns.rating.visible).toBe(true);
  });

  it('keeps column visibility, widths, order, and sorting independent per view', () => {
    libraryViewSettings.setActiveView('artists');
    libraryViewSettings.setColumnVisibility('plays', true);
    libraryViewSettings.setColumnWidth('title', 444);
    libraryViewSettings.moveColumn('duration', 'title', 'before');
    libraryViewSettings.setSort('album');

    libraryViewSettings.setActiveView('albums');
    const albums = libraryViewSettings.getSnapshot().views.albums;

    expect(albums.columns.plays.visible).toBe(false);
    expect(albums.columns.title.width).toBe(LIBRARY_COLUMN_DEFAULT_WIDTHS.title);
    expect(albums.order[0]).toBe('title');
    expect(albums.sort).toEqual({ columnId: 'title', direction: 'asc' });

    const artists = libraryViewSettings.getSnapshot().views.artists;
    expect(artists.columns.plays.visible).toBe(true);
    expect(artists.columns.title.width).toBe(444);
    expect(artists.order[0]).toBe('duration');
    expect(artists.sort).toEqual({ columnId: 'album', direction: 'asc' });
  });

  it('keeps independently ordered pins for each grouped view', () => {
    libraryViewSettings.pinGroup('artists', 'artists:first');
    libraryViewSettings.pinGroup('artists', 'artists:second');
    libraryViewSettings.pinGroup('albums', 'albums:only');
    libraryViewSettings.movePinnedGroup('artists', 'artists:second', 'artists:first', 'before');

    expect(libraryViewSettings.getSnapshot().pinnedGroupKeys.artists).toEqual([
      'artists:second',
      'artists:first'
    ]);
    expect(libraryViewSettings.getSnapshot().pinnedGroupKeys.albums).toEqual(['albums:only']);

    libraryViewSettings.unpinGroup('artists', 'artists:second');
    expect(libraryViewSettings.getSnapshot().pinnedGroupKeys.artists).toEqual(['artists:first']);
  });

  it('shows every library view tab by default', () => {
    expect(libraryViewSettings.getSnapshot().visibleViews).toEqual(LIBRARY_VIEW_IDS);
  });

  it('toggles library view tabs while keeping canonical order', () => {
    libraryViewSettings.toggleViewVisibility('genres');
    libraryViewSettings.toggleViewVisibility('ratings');

    expect(libraryViewSettings.getSnapshot().visibleViews).toEqual([
      'favorites',
      'songs',
      'artists',
      'albums',
      'years',
      'formats',
      'folders'
    ]);

    libraryViewSettings.toggleViewVisibility('genres');
    libraryViewSettings.toggleViewVisibility('ratings');
    expect(libraryViewSettings.getSnapshot().visibleViews).toEqual(LIBRARY_VIEW_IDS);
  });

  it('switches the active view when its tab is hidden', () => {
    libraryViewSettings.setActiveView('artists');
    libraryViewSettings.toggleViewVisibility('artists');

    const snapshot = libraryViewSettings.getSnapshot();
    expect(snapshot.visibleViews).not.toContain('artists');
    expect(snapshot.activeView).toBe('favorites');
  });

  it('keeps the last visible view tab from being hidden', () => {
    for (const view of LIBRARY_VIEW_IDS) {
      if (view !== 'favorites') libraryViewSettings.toggleViewVisibility(view);
    }

    expect(libraryViewSettings.getSnapshot().visibleViews).toEqual(['favorites']);

    libraryViewSettings.toggleViewVisibility('favorites');
    expect(libraryViewSettings.getSnapshot().visibleViews).toEqual(['favorites']);
  });
});
