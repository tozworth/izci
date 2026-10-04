import { beforeEach, describe, expect, it } from 'vitest';
import { libraryViewSettings } from './library-view-settings';

beforeEach(() => libraryViewSettings.reset());

describe('library browser preferences', () => {
  it('remembers layouts and thumbnail size separately for each tab', () => {
    libraryViewSettings.setLayout('grid');
    libraryViewSettings.adjustTileSize(24);
    libraryViewSettings.toggleViewVisibility('images');
    libraryViewSettings.setActiveView('images');
    libraryViewSettings.setLayout('gallery');
    expect(libraryViewSettings.getSnapshot().views.images.layout).toBe('gallery');
    expect(libraryViewSettings.getSnapshot().views.images.tileSize).toBe(144);
    libraryViewSettings.setActiveView('allMedia');
    expect(libraryViewSettings.getSnapshot().views.allMedia.layout).toBe('grid');
    expect(libraryViewSettings.getSnapshot().views.allMedia.tileSize).toBe(168);
  });

  it('allows gallery only for the images and videos tabs', () => {
    for (const view of ['allMedia', 'songs', 'albums', 'folders', 'images', 'videos'] as const) {
      if (!libraryViewSettings.getSnapshot().visibleViews.includes(view)) libraryViewSettings.toggleViewVisibility(view);
      libraryViewSettings.setActiveView(view);
      libraryViewSettings.setLayout('gallery');
      expect(libraryViewSettings.getSnapshot().views[view].layout).toBe(view === 'images' || view === 'videos' ? 'gallery' : 'list');
    }
  });

  it('can target the displayed tab when ratings are disabled by presentation', () => {
    libraryViewSettings.setActiveView('ratings');
    libraryViewSettings.setLayout('grid', 'allMedia');
    libraryViewSettings.adjustTileSize(24, 'allMedia');
    expect(libraryViewSettings.getSnapshot().views.allMedia.layout).toBe('grid');
    expect(libraryViewSettings.getSnapshot().views.allMedia.tileSize).toBe(168);
    expect(libraryViewSettings.getSnapshot().views.ratings.layout).toBe('list');
  });

  it('bounds thumbnail sizes without touching table sorting or column state', () => {
    libraryViewSettings.setSort('artist');
    libraryViewSettings.setColumnVisibility('album', true);
    libraryViewSettings.adjustTileSize(1000);
    expect(libraryViewSettings.getSnapshot().views.allMedia.tileSize).toBe(256);
    libraryViewSettings.adjustTileSize(-1000);
    expect(libraryViewSettings.getSnapshot().views.allMedia.tileSize).toBe(80);
    expect(libraryViewSettings.getSnapshot().views.allMedia.sort.columnId).toBe('artist');
    expect(libraryViewSettings.getSnapshot().views.allMedia.columns.album.visible).toBe(true);
  });
});
