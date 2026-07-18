import { beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_COLUMN_DEFAULT_WIDTHS, libraryViewSettings } from './library-view-settings';

describe('library view settings', () => {
  beforeEach(() => {
    libraryViewSettings.reset();
  });

  it('provides context-aware column defaults for grouped views', () => {
    const views = libraryViewSettings.getSnapshot().views;

    expect(views.songs.columns.artist.visible).toBe(true);
    expect(views.artists.columns.artist.visible).toBe(false);
    expect(views.artists.columns.album.visible).toBe(true);
    expect(views.albums.columns.album.visible).toBe(false);
    expect(views.formats.columns.format.visible).toBe(false);
    expect(views.folders.columns.folder.visible).toBe(false);
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
});
