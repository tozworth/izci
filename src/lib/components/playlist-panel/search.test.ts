import { describe, expect, it } from 'vitest';

import {
  filterItemsByQuery,
  formatTotalDuration,
  getTrackSummary,
  matchesSearchQuery
} from './search';
import type { PlaylistItem } from '$lib/contracts/catalog';

function item(name: string, metadata: PlaylistItem['metadata'] = {}): PlaylistItem {
  return {
    id: name,
    name,
    extension: name.split('.').at(-1) ?? '',
    kind: 'stream',
    size: 0,
    lastModified: 0,
    metadata
  };
}

describe('playlist-panel search helpers', () => {
  const tracks = [
    item('Alpha Artist - Morning.flac', {
      title: 'Morning',
      artist: 'Alpha Artist',
      album: 'First Light',
      genre: 'Ambient',
      year: '2022',
      duration: 125
    }),
    {
      ...item('Night Drive.xm', {
        title: 'Night Drive',
        artist: 'Tracker Unit',
        album: 'Modules',
        duration: 3605
      }),
      kind: 'module' as const,
      path: 'Music/Tracker Albums/Track.flac'
    }
  ];

  it('matches normalized queries against default library columns', () => {
    expect(matchesSearchQuery(tracks[0], 'alpha')).toBe(true);
    expect(matchesSearchQuery(tracks[1], 'flac')).toBe(false);
    expect(matchesSearchQuery(tracks[1], 'xm')).toBe(true);
    expect(matchesSearchQuery(tracks[1], 'tracker albums')).toBe(true);
    expect(matchesSearchQuery(tracks[1], 'tracker module')).toBe(true);
    expect(matchesSearchQuery(tracks[0], 'ambient')).toBe(true);
    expect(matchesSearchQuery(tracks[0], '2022')).toBe(true);
    expect(matchesSearchQuery(tracks[0], 'alpha light')).toBe(true);
  });

  it('filters items only when a query is present', () => {
    expect(filterItemsByQuery(tracks, '')).toBe(tracks);
    expect(filterItemsByQuery(tracks, 'night')).toEqual([tracks[1]]);
  });

  it('formats playlist summary durations', () => {
    expect(formatTotalDuration(0)).toBe('--:--');
    expect(formatTotalDuration(125)).toBe('02:05');
    expect(formatTotalDuration(3605)).toBe('1:00:05');
    expect(getTrackSummary(tracks, [tracks[0]], 'alpha')).toBe('1 of 2 songs · 02:05');
  });
});
