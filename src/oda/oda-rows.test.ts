import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import { buildOdaGroupDisplayRows, buildOdaTrackDisplayRows } from './oda-rows';

function track(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'track-1',
    name: 'file.flac',
    extension: 'flac',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    path: '/music/file.flac',
    ...overrides
  };
}

describe('buildOdaTrackDisplayRows', () => {
  it('formats title, metadata, duration and playing state', () => {
    const item = track({
      id: 'a',
      name: 'fallback.flac',
      metadata: { title: 'Real title', artist: 'Artist', album: 'Album', duration: 125 }
    });
    const [row] = buildOdaTrackDisplayRows([item], 'a');

    expect(row).toEqual({
      focusId: 'item:a',
      title: 'Real title',
      meta: 'Artist · Album',
      trailing: '02:05',
      playing: true
    });
  });

  it('falls back to the file name and hides non-finite durations', () => {
    const [row] = buildOdaTrackDisplayRows([track({ id: 'b', metadata: { duration: Number.NaN } })]);

    expect(row.title).toBe('file');
    expect(row.meta).toBe('');
    expect(row.trailing).toBe('');
    expect(row.playing).toBe(false);
  });
});

describe('buildOdaGroupDisplayRows', () => {
  it('renders group label, secondary and item count', () => {
    const items = [
      track({ id: 'a', metadata: { artist: 'Aphex Twin' } }),
      track({ id: 'b', metadata: { artist: 'Aphex Twin' } }),
      track({ id: 'c', metadata: { artist: 'Boards' } })
    ];
    const rows = buildOdaGroupDisplayRows(items, 'artists');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: 'Aphex Twin', trailing: '2', playing: false });
    expect(rows[1]).toMatchObject({ title: 'Boards', trailing: '1' });
    expect(rows[0].focusId.startsWith('group:')).toBe(true);
  });
});
