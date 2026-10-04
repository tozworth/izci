import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import { buildLibraryContextActions, buildFavoritesContextActions, buildCoopLibraryContextActions, buildFreeplayLibraryContextActions } from './workspace-actions';

describe('image context actions', () => {
  const photo: TrackItem = { id: 'photo', name: 'Photo.png', kind: 'image', extension: 'png', size: 1, lastModified: 1 };
  const song: TrackItem = { ...photo, id: 'song', kind: 'stream' };

  it('offers catalog actions without playback queue commands for images in every mode', () => {
    for (const actions of [
      buildLibraryContextActions([photo], [], ['photo']),
      buildFavoritesContextActions([photo], [photo], ['photo']),
      buildCoopLibraryContextActions([photo], [photo], ['photo']),
      buildFreeplayLibraryContextActions([photo], [photo], ['photo'])
    ]) {
      expect(actions.map((action) => action.id)).not.toEqual(expect.arrayContaining(['add-to-queue']));
      expect(actions.some((action) => ['replace-queue', 'play-next', 'reset-play-count'].includes(action.id))).toBe(false);
      expect(actions.some((action) => action.id === 'track-details')).toBe(true);
    }
  });

  it('keeps queue commands available for mixed selections', () => {
    expect(buildLibraryContextActions([photo, song], [], ['photo', 'song']).map((action) => action.id)).toContain('add-to-queue');
  });
});
