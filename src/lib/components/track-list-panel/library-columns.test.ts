import { describe, expect, it } from 'vitest';

import {
  compareItems,
  fitWidthsToAvailableWidth,
  getColumnTextValue,
  getTrackDuration,
  getTrackLastPlayed,
  getTrackPlayCount,
  rebalanceResizedColumns
} from './library-columns';
import type { TrackItem } from '$lib/types';

function item(id: string, overrides: Partial<TrackItem> = {}): TrackItem {
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
        discNumber: ' 2/3 ',
        trackNumber: ' 7/12 ',
        duration: 125
      },
      path: 'Music/Artist/Album/Track.flac'
    });

    expect(getColumnTextValue(track, 'title')).toBe('Tagged Title');
    expect(getColumnTextValue(track, 'artist')).toBe('Artist');
    expect(getColumnTextValue(track, 'album')).toBe('Album');
    expect(getColumnTextValue(track, 'discAndTrack')).toBe('2/3 / 7/12');
    expect(getColumnTextValue(track, 'folder')).toBe('Music/Artist/Album');
    expect(getColumnTextValue(track, 'format')).toBe('FLAC');
    expect(getTrackDuration(track)).toBe('02:05');
    expect(getTrackDuration(item('missing-duration'))).toBe('');
    expect(getTrackPlayCount(item('plays', { metadata: { playCount: 3 } }))).toBe('3');
    expect(getColumnTextValue(item('rated', { rating: 3.5 }), 'rating')).toBe('3.5');
    expect(getColumnTextValue(item('missing-plays'), 'plays')).toBe('');
    expect(getTrackLastPlayed(item('last-played', { metadata: { lastPlayed: new Date(2026, 7, 14).getTime() } }))).toBe('Aug 14, 2026');
    expect(getColumnTextValue(item('missing-last-played'), 'lastPlayed')).toBe('');
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

  it('rebalances resized columns against the nearest neighbor', () => {
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
    expect(resized.artist).toBeCloseTo(120);
    expect(resized.format).toBeCloseTo(96);

    const shrunk = rebalanceResizedColumns(resized, ['title', 'artist', 'format'], 'title', -50);

    expect(shrunk.title).toBeCloseTo(350);
    expect(shrunk.artist).toBeCloseTo(170);
    expect(shrunk.format).toBeCloseTo(96);
  });

  it('cascades resizing only when the nearest neighbor reaches its minimum', () => {
    const resized = rebalanceResizedColumns(
      {
        title: 300,
        artist: 90,
        format: 96,
        duration: 104
      },
      ['title', 'artist', 'format', 'duration'],
      'title',
      100
    );

    expect(resized.title).toBeCloseTo(400);
    expect(resized.artist).toBeCloseTo(72);
    expect(resized.format).toBeCloseTo(48);
    expect(resized.duration).toBeCloseTo(70);
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

    const lastPlayedTracks = [
      item('old', { metadata: { title: 'Old', lastPlayed: 100 } }),
      item('newer', { metadata: { title: 'Newer', lastPlayed: 300 } }),
      item('never', { metadata: { title: 'Never' } })
    ];

    expect([...lastPlayedTracks].sort((left, right) => compareItems(left, right, { columnId: 'lastPlayed', direction: 'desc' })).map((track) => track.id)).toEqual([
      'newer',
      'old',
      'never'
    ]);
    expect([...lastPlayedTracks].sort((left, right) => compareItems(left, right, { columnId: 'lastPlayed', direction: 'asc' })).map((track) => track.id)).toEqual([
      'old',
      'newer',
      'never'
    ]);

    const ratedTracks = [
      item('half', { rating: 0.5 }),
      item('five', { rating: 5 }),
      item('none')
    ];
    expect([...ratedTracks].sort((left, right) => compareItems(left, right, { columnId: 'rating', direction: 'desc' })).map((track) => track.id)).toEqual([
      'five',
      'half',
      'none'
    ]);

    const numberedTracks = [
      item('track-ten', { metadata: { title: 'Ten', discNumber: '2', trackNumber: '10' } }),
      item('track-two', { metadata: { title: 'Two', discNumber: '1', trackNumber: '2' } }),
      item('track-one', { metadata: { title: 'One', discNumber: '1', trackNumber: '1' } }),
      item('unnumbered', { metadata: { title: 'Unnumbered' } })
    ];

    expect([...numberedTracks].sort((left, right) => compareItems(left, right, { columnId: 'discAndTrack', direction: 'asc' })).map((track) => track.id)).toEqual([
      'track-one',
      'track-two',
      'track-ten',
      'unnumbered'
    ]);
  });
});
