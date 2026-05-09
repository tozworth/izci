import { describe, expect, it } from 'vitest';

import {
  compareItems,
  fitWidthsToAvailableWidth,
  getColumnTextValue,
  getTrackDuration,
  getTrackPlayCount,
  rebalanceResizedColumns
} from './library-columns';
import type { PlaylistItem } from '$lib/types';

function item(id: string, overrides: Partial<PlaylistItem> = {}): PlaylistItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 0,
    lastModified: 0,
    ...overrides
  };
}

describe('library column helpers', () => {
  it('formats text values from metadata with filename fallback', () => {
    const track = item('filename-title', {
      metadata: {
        title: ' Tagged Title ',
        artist: ' Artist ',
        album: ' Album ',
        duration: 125
      }
    });

    expect(getColumnTextValue(track, 'title')).toBe('Tagged Title');
    expect(getColumnTextValue(track, 'artist')).toBe('Artist');
    expect(getColumnTextValue(track, 'album')).toBe('Album');
    expect(getColumnTextValue(track, 'format')).toBe('FLAC');
    expect(getTrackDuration(track)).toBe('02:05');
    expect(getTrackDuration(item('missing-duration'))).toBe('');
    expect(getTrackPlayCount(item('plays', { metadata: { playCount: 3 } }))).toBe('3');
    expect(getColumnTextValue(item('missing-plays'), 'plays')).toBe('');
  });

  it('shrinks and expands visible widths while preserving the available total', () => {
    const columns = [
      { id: 'title' as const, width: 300 },
      { id: 'artist' as const, width: 220 },
      { id: 'format' as const, width: 96 }
    ];

    const shrunk = fitWidthsToAvailableWidth(columns, 360);
    const expanded = fitWidthsToAvailableWidth(columns, 720);

    expect(Object.values(shrunk).reduce((sum, width) => sum + width, 0)).toBeCloseTo(360);
    expect(shrunk.title).toBeGreaterThanOrEqual(72);
    expect(shrunk.artist).toBeGreaterThanOrEqual(72);
    expect(shrunk.format).toBeGreaterThanOrEqual(48);
    expect(Object.values(expanded).reduce((sum, width) => sum + width, 0)).toBeCloseTo(720);
  });

  it('rebalance resized columns by borrowing from adjacent visible columns', () => {
    const resized = rebalanceResizedColumns(
      {
        title: 300,
        artist: 220,
        format: 96
      },
      ['title', 'artist', 'format'],
      'title',
      100
    );

    expect(resized.title).toBeCloseTo(400);
    expect((resized.artist ?? 0) + (resized.format ?? 0)).toBeCloseTo(216);
  });

  it('sorts missing values last and falls back to title/name for ties', () => {
    const tracks = [
      item('z-file', { name: 'Zeta.flac', metadata: { artist: 'Artist', title: 'B title', duration: 20 } }),
      item('a-file', { name: 'Alpha.flac', metadata: { artist: 'Artist', title: 'A title', duration: 10 } }),
      item('missing', { name: 'Missing.flac', metadata: { title: 'Missing title' } })
    ];

    expect([...tracks].sort((left, right) => compareItems(left, right, { columnId: 'artist', direction: 'asc' })).map((track) => track.id)).toEqual([
      'a-file',
      'z-file',
      'missing'
    ]);
    expect([...tracks].sort((left, right) => compareItems(left, right, { columnId: 'duration', direction: 'desc' })).map((track) => track.id)).toEqual([
      'z-file',
      'a-file',
      'missing'
    ]);

    const playCountTracks = [
      item('two', { metadata: { title: 'Two', playCount: 2 } }),
      item('five', { metadata: { title: 'Five', playCount: 5 } }),
      item('none', { metadata: { title: 'None' } })
    ];

    expect([...playCountTracks].sort((left, right) => compareItems(left, right, { columnId: 'plays', direction: 'desc' })).map((track) => track.id)).toEqual([
      'five',
      'two',
      'none'
    ]);
  });
});
