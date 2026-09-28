import { describe, expect, it } from 'vitest';

import {
  filterItemsByQuery,
  formatTotalDuration,
  matchesSearchQuery
} from './search';
import { getLocalizedItemCount, getLibraryGroupSummary, getLocalizedTrackSummary, getQueueSummaryKind } from './summaries';
import type { TrackItem } from '$lib/types';

function item(name: string, metadata: TrackItem['metadata'] = {}): TrackItem {
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

describe('track-list-panel search helpers', () => {
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

  it('formats queue summary durations', () => {
    expect(formatTotalDuration(0)).toBe('--:--');
    expect(formatTotalDuration(125)).toBe('02:05');
    expect(formatTotalDuration(3605)).toBe('1:00:05');
    expect(getLocalizedTrackSummary(tracks, [tracks[0]], 'alpha', (_id, options) => {
      const values = options?.values;
      return `${values?.visible} of ${values?.total} songs · ${values?.duration}`;
    })).toBe('1 of 2 songs · 02:05');
  });

  it('classifies queue count labels by the same media rules for every surface', () => {
    const image = { ...item('cover.png'), kind: 'image' as const };
    const video = { ...item('clip.mp4'), kind: 'video' as const };
    expect(getQueueSummaryKind(tracks)).toBe('songs');
    expect(getQueueSummaryKind([image])).toBe('images');
    expect(getQueueSummaryKind([video])).toBe('videos');
    expect(getQueueSummaryKind([tracks[0], image])).toBe('items');
  });

  it('uses media-aware counts in library groups and preserves the filtered source kind', () => {
    const image = { ...item('cover.png'), kind: 'image' as const };
    const video = { ...item('clip.mp4'), kind: 'video' as const };
    const translate = (id: string) => id;
    expect(getLocalizedItemCount(tracks, translate)).toBe('library.summary.countSongs');
    expect(getLocalizedItemCount([image], translate)).toBe('library.summary.countImages');
    expect(getLocalizedItemCount([video], translate)).toBe('library.summary.countVideos');
    expect(getLocalizedItemCount([image, tracks[0]], translate)).toBe('library.summary.countItems');
    expect(getLocalizedItemCount([], translate)).toBe('library.summary.countItems');
    expect(getLocalizedTrackSummary([image, video], [image], 'cover', translate))
      .toBe('queue.summary.filteredTracksItems');
    expect(getLocalizedTrackSummary([image], [], 'missing', translate))
      .toBe('queue.summary.filteredTracksImages');
    const calls: string[] = [];
    getLibraryGroupSummary('folders', 1, 2, [image], 'cover', (id) => {
      calls.push(id);
      return id;
    });
    expect(calls).toEqual([
      'library.summary.filteredFolders',
      'library.summary.countImages',
      'library.summary.groupsAndItems'
    ]);
  });

});
