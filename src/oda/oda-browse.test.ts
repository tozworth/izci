import { describe, expect, it } from 'vitest';
import type { TrackItem, TrackKind } from '$lib/types';
import {
  buildOdaBrowseGroupRows,
  buildOdaBrowseTrackRows,
  isOdaGroupedBrowseView,
  odaBrowseGroupKey,
  odaBrowseTrackId,
  odaGroupFocusId,
  odaTrackFocusId,
  resolveOdaBrowseGroup
} from './oda-browse';

let sequence = 0;

function track(kind: TrackKind, metadata: TrackItem['metadata'] = {}, path?: string): TrackItem {
  sequence += 1;
  const itemPath = path ?? `/music/file-${sequence}.flac`;
  return {
    id: `track-${sequence}`,
    name: `file-${sequence}.flac`,
    extension: kind === 'module' ? 'mod' : 'flac',
    kind,
    size: 1,
    lastModified: 1,
    path: itemPath,
    metadata
  };
}

const LIBRARY: TrackItem[] = [
  track('stream', { artist: 'Aphex Twin', album: 'SAW', genre: 'Ambient', year: '1992' }, '/music/aphex/1.flac'),
  track('module', { artist: 'Aphex Twin', album: 'SAW', genre: 'Ambient; Electronic', year: '1992' }, '/music/aphex/2.mod'),
  track('stream', { artist: 'Boards of Canada', album: 'MHTRTC', genre: 'Electronic', year: '1998' }, '/music/boc/1.flac'),
  track('stream', { album: 'Untitled' }, '/music/unknown.flac')
];

describe('Oda browse focus IDs', () => {
  it('round-trips track and group IDs', () => {
    expect(odaBrowseTrackId(odaTrackFocusId('abc'))).toBe('abc');
    expect(odaBrowseGroupKey(odaGroupFocusId('artists:abc'))).toBe('artists:abc');
    expect(odaBrowseTrackId(odaGroupFocusId('x'))).toBeNull();
    expect(odaBrowseGroupKey(odaTrackFocusId('x'))).toBeNull();
    expect(odaBrowseTrackId(null)).toBeNull();
  });

  it('classifies grouped versus flat views', () => {
    expect(isOdaGroupedBrowseView('artists')).toBe(true);
    expect(isOdaGroupedBrowseView('folders')).toBe(true);
    expect(isOdaGroupedBrowseView('songs')).toBe(false);
  });
});

describe('buildOdaBrowseGroupRows', () => {
  it('groups music items with counts and stable keys', () => {
    const rows = buildOdaBrowseGroupRows(LIBRARY, 'artists');
    const aphex = rows.find((row) => row.label === 'Aphex Twin');
    const boards = rows.find((row) => row.label === 'Boards of Canada');
    const unknown = rows.find((row) => row.label === 'Unknown artist');

    expect(aphex?.count).toBe(2);
    expect(boards?.count).toBe(1);
    expect(unknown?.count).toBe(1);
    expect(aphex?.focusId).toBe(odaGroupFocusId(aphex!.key));
  });

  it('keeps distinct secondary labels for duplicate album names', () => {
    const items = [
      track('stream', { artist: 'A', album: 'Same' }),
      track('stream', { artist: 'B', album: 'Same' })
    ];
    const rows = buildOdaBrowseGroupRows(items, 'albums');
    expect(rows.filter((row) => row.label === 'Same')).toHaveLength(2);
  });
});

describe('resolveOdaBrowseGroup', () => {
  it('returns the group tracks for a key and null when missing', () => {
    const [group] = buildOdaBrowseGroupRows(LIBRARY, 'genres');
    const resolved = resolveOdaBrowseGroup(LIBRARY, 'genres', group.key);

    expect(resolved?.key).toBe(group.key);
    expect(resolved?.items).toHaveLength(group.count);
    expect(resolveOdaBrowseGroup(LIBRARY, 'genres', 'missing')).toBeNull();
  });
});

describe('buildOdaBrowseTrackRows', () => {
  it('builds track rows keyed by focus ID', () => {
    const rows = buildOdaBrowseTrackRows(LIBRARY);
    expect(rows).toHaveLength(LIBRARY.length);
    expect(rows[0].focusId).toBe(odaTrackFocusId(LIBRARY[0].id));
    expect(rows[0].track).toBe(LIBRARY[0]);
  });
});
