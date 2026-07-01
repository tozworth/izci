import { describe, expect, it } from 'vitest';

import { hasSameTrackMetadata, resolveTrackSnapshot } from './artwork-presentation';
import type { PlaylistItem } from '$lib/types';

function item(id: string, overrides: Partial<PlaylistItem> = {}): PlaylistItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    ...overrides
  };
}

describe('artwork presentation helpers', () => {
  it('resolves the freshest selected, playlist, or library track snapshot', () => {
    const stale = item('track', { metadata: { title: 'Old' } });
    const selected = item('track', { metadata: { title: 'Selected' } });
    const playlist = item('track', { metadata: { title: 'Playlist' } });
    const library = item('track', { metadata: { title: 'Library' } });

    expect(resolveTrackSnapshot(null, selected, [playlist], [library])).toBeNull();
    expect(resolveTrackSnapshot(stale, selected, [playlist], [library])).toBe(selected);
    expect(resolveTrackSnapshot(stale, item('other'), [playlist], [library])).toBe(playlist);
    expect(resolveTrackSnapshot(stale, item('other'), [], [library])).toBe(library);
    expect(resolveTrackSnapshot(stale, item('other'), [], [])).toBe(stale);
  });

  it('compares only track metadata for details refresh decisions', () => {
    expect(hasSameTrackMetadata(item('a'), item('b'))).toBe(true);
    expect(
      hasSameTrackMetadata(
        item('a', { metadata: { title: 'Track', artist: 'Artist' } }),
        item('b', { metadata: { title: 'Track', artist: 'Artist' } })
      )
    ).toBe(true);
    expect(hasSameTrackMetadata(item('a', { metadata: { title: 'One' } }), item('a'))).toBe(false);
  });
});
