import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import {
  buildLibraryGroups,
  countLibraryGroups,
  filterLibraryGroupItems,
  filterLibraryGroups,
  getLibraryViewTooltipDetails,
  orderLibraryGroups
} from './library-views';

function track(id: string, metadata: PlaylistItem['metadata'], path?: string): PlaylistItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 0,
    lastModified: 0,
    path,
    metadata
  };
}

const tracks = [
  track('one', { title: 'First', artist: 'Aster', album: 'Light', genre: 'Ambient; Electronic; ambient', year: '2024' }, 'Music/A/one.flac'),
  track('two', { title: 'Second', artist: 'Aster', album: 'Night', genre: 'Electronic', year: '2023-01-01' }, 'Music/A/two.flac'),
  track('three', { title: 'Third' })
];

describe('library view projections', () => {
  it('groups tracks by metadata and retains unknown values', () => {
    const artists = buildLibraryGroups(tracks, 'artists');
    expect(artists.map((group) => [group.label, group.items.length])).toEqual([
      ['Aster', 2],
      ['Unknown artist', 1]
    ]);
  });

  it('supports multi-value genres and newest-first years', () => {
    expect(buildLibraryGroups(tracks, 'genres').find((group) => group.label === 'Electronic')?.items).toHaveLength(2);
    expect(buildLibraryGroups(tracks, 'genres').find((group) => group.label.toLowerCase() === 'ambient')?.items).toHaveLength(1);
    expect(buildLibraryGroups(tracks, 'years').map((group) => group.label)).toEqual([
      '2024',
      '2023',
      'Unknown year'
    ]);
  });

  it('groups formats while distinguishing their playback family', () => {
    const mixedTracks = [
      tracks[0],
      { ...tracks[1], id: 'module', name: 'module.xm', extension: 'xm', kind: 'module' as const }
    ];
    expect(buildLibraryGroups(mixedTracks, 'formats').map((group) => [group.label, group.secondary])).toEqual([
      ['FLAC', 'Stream'],
      ['XM', 'Tracker module']
    ]);
  });

  it('searches both group labels and tracks inside every group view', () => {
    const albums = buildLibraryGroups(tracks, 'albums');
    expect(filterLibraryGroups(albums, 'third').map((group) => group.label)).toEqual(['Unknown album']);

    const aster = buildLibraryGroups(tracks, 'artists')[0];
    expect(filterLibraryGroupItems(aster, 'second').map((item) => item.id)).toEqual(['two']);
    expect(filterLibraryGroupItems(aster, 'aster')).toHaveLength(2);
  });

  it('builds count details for every root view regardless of the active tab', () => {
    const details = getLibraryViewTooltipDetails([
      { ...tracks[0], metadata: { ...tracks[0].metadata, duration: 60 } },
      { ...tracks[1], metadata: { ...tracks[1].metadata, duration: 90 } },
      tracks[2]
    ], [tracks[0]], '');

    expect(details.favorites).toBe('1');
    expect(details.songs).toBe('3 · 02:30');
    expect(details.artists).toBe('2');
    expect(details.albums).toBe('3');
  });

  it('counts nested folders and multi-value groups without constructing sorted projections', () => {
    expect(countLibraryGroups(tracks, 'genres')).toBe(3);
    expect(countLibraryGroups(tracks, 'folders')).toBe(3);
  });

  it('places pinned groups first in pin order and leaves other groups sorted', () => {
    const groups = buildLibraryGroups(tracks, 'artists');
    const keys = groups.map((group) => group.key);
    const ordered = orderLibraryGroups(groups, [keys[1], 'missing', keys[0]]);

    expect(ordered.map((group) => group.key)).toEqual([keys[1], keys[0], ...keys.slice(2)]);
  });

  it('builds folders as a depth-first tree with ancestor song totals', () => {
    const folders = buildLibraryGroups([
      track('one', { title: 'One' }, 'Opus/Artist/Album/one.flac'),
      track('two', { title: 'Two' }, 'Opus/Artist/Other/two.flac'),
      track('three', { title: 'Three' }, 'Archive/three.flac')
    ], 'folders');

    expect(folders.map((group) => [group.label, group.depth, group.items.length, group.hasChildren])).toEqual([
      ['Archive', 0, 1, false],
      ['Opus', 0, 2, true],
      ['Artist', 1, 2, true],
      ['Album', 2, 1, false],
      ['Other', 2, 1, false]
    ]);
    expect(folders.find((group) => group.label === 'Artist')?.parentKey)
      .toBe(folders.find((group) => group.label === 'Opus')?.key);
  });

  it('retains folder ancestors when search matches a descendant folder', () => {
    const folders = buildLibraryGroups([
      track('one', { title: 'One' }, 'Opus/Artist/Special Album/one.flac')
    ], 'folders');

    expect(filterLibraryGroups(folders, 'special').map((group) => group.label)).toEqual([
      'Opus',
      'Artist',
      'Special Album'
    ]);
  });
});
