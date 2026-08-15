import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import { resolveTrackLibraryNavigationTargets } from './library-navigation';

function track(id: string, overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id,
    name: 'song.flac',
    extension: 'flac',
    kind: 'stream',
    size: 123,
    lastModified: 456,
    path: 'Music/Artist/song.flac',
    metadata: {
      title: 'Song',
      artist: 'Track Artist',
      albumArtist: 'Album Artist',
      album: 'Album',
      genre: 'Rock; Electronic',
      year: '2024-01-01'
    },
    ...overrides
  };
}

describe('track library navigation', () => {
  it('resolves an equivalent library track into its exact grouped views', () => {
    const libraryTrack = track('library');
    const sourceTrack = track('queue');
    const targets = resolveTrackLibraryNavigationTargets(sourceTrack, [libraryTrack]);

    expect(targets.artist).toBeUndefined();
    expect(targets.album).toMatchObject({ view: 'albums', trackId: 'library' });
    expect(targets.genre).toMatchObject({ view: 'genres', trackId: 'library' });
    expect(targets.genre?.groupKey).toContain('rock');
    expect(targets.year).toMatchObject({ view: 'years', trackId: 'library' });
    expect(targets.format).toMatchObject({ view: 'formats', trackId: 'library' });
  });

  it('links the artist when it is represented by the library artist group', () => {
    const libraryTrack = track('library', {
      metadata: { title: 'Song', artist: 'Track Artist' }
    });
    const targets = resolveTrackLibraryNavigationTargets(libraryTrack, [libraryTrack]);

    expect(targets.artist).toMatchObject({ view: 'artists', trackId: 'library' });
  });

  it('does not expose links when the track is absent from the library', () => {
    expect(resolveTrackLibraryNavigationTargets(track('queue'), [])).toEqual({});
  });
});
