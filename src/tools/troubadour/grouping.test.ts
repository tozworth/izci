import { describe, expect, it } from 'vitest';
import { autoGroupTracks, renumberAlbumTracks } from './grouping';

describe('Troubadour album grouping', () => {
  it('prefers album tags and sorts disc/track positions', () => {
    const groups = autoGroupTracks([
      { id: 'b', path: 'Music/Album/02.flac', album: 'Album', albumArtist: 'Artist', discNumber: '1', trackNumber: '2' },
      { id: 'a', path: 'Music/Album/01.flac', album: 'Album', albumArtist: 'Artist', discNumber: '1', trackNumber: '1' }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemIds).toEqual(['a', 'b']);
  });

  it('uses folders only as a configured fallback', () => {
    const track = { id: 'a', path: 'Music/Unknown/song.flac' };
    expect(autoGroupTracks([track], 'folder')[0].title).toBe('Unknown');
    expect(autoGroupTracks([track], 'none')).toEqual([]);
  });

  it('renumbers explicitly and does not mutate ordering', () => {
    expect([...renumberAlbumTracks(['b', 'a'], 1, 2)]).toEqual([['b', '01'], ['a', '02']]);
  });
});
