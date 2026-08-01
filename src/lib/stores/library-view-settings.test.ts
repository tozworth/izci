import { beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_COLUMN_DEFAULT_WIDTHS, libraryViewSettings } from './library-view-settings';

describe('library view settings', () => {
  beforeEach(() => {
    libraryViewSettings.reset();
  });

  it('provides context-aware column defaults for grouped views', () => {
    const views = libraryViewSettings.getSnapshot().views;

    for (const view of Object.values(views)) {
      expect(view.columns.folder.visible).toBe(false);
      expect(view.columns.format.visible).toBe(false);
      expect(view.columns.discAndTrack.visible).toBe(false);
    }

    expect(views.songs.columns.artist.visible).toBe(true);
    expect(views.favorites.columns.artist.visible).toBe(true);
    expect(views.artists.columns.artist.visible).toBe(false);
    expect(views.artists.columns.album.visible).toBe(true);
    expect(views.albums.columns.album.visible).toBe(false);
  });

  it('allows optional columns to be restored per view', () => {
    libraryViewSettings.setColumnVisibility('folder', true);
    libraryViewSettings.setColumnVisibility('format', true);
    libraryViewSettings.setColumnVisibility('discAndTrack', true);

    const songs = libraryViewSettings.getSnapshot().views.songs;
    expect(songs.columns.folder.visible).toBe(true);
    expect(songs.columns.format.visible).toBe(true);
    expect(songs.columns.discAndTrack.visible).toBe(true);
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
});
