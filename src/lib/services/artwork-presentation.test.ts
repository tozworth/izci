import { describe, expect, it } from 'vitest';

import {
  createArtworkPresentationController,
  hasSameTrackMetadata,
  resolveTrackSnapshot
} from './artwork-presentation';
import type { LoadedStreamArtwork } from './stream-artwork';
import type { TrackItem } from '$lib/types';

function item(id: string, overrides: Partial<TrackItem> = {}): TrackItem {
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
  it('resolves the freshest selected, queue, or library track snapshot', () => {
    const stale = item('track', { metadata: { title: 'Old' } });
    const selected = item('track', { metadata: { title: 'Selected' } });
    const queue = item('track', { metadata: { title: 'Queue' } });
    const library = item('track', { metadata: { title: 'Library' } });

    expect(resolveTrackSnapshot(null, selected, [queue], [library])).toBeNull();
    expect(resolveTrackSnapshot(stale, selected, [queue], [library])).toBe(selected);
    expect(resolveTrackSnapshot(stale, item('other'), [queue], [library])).toBe(queue);
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

  it('keeps displayed artwork while the next track artwork is loading, then clears it when absent', async () => {
    const firstArtwork: LoadedStreamArtwork = {
      url: 'blob:first',
      mediaImage: { src: 'blob:first' }
    };
    let resolveSecondArtwork: (artwork: LoadedStreamArtwork | null) => void = () => {};
    const secondArtwork = new Promise<LoadedStreamArtwork | null>((resolve) => {
      resolveSecondArtwork = resolve;
    });
    const controller = createArtworkPresentationController({
      resolveTrackSnapshot: (track) => track,
      isPlaybackDetailsPending: () => false,
      loadArtwork: (track) => track?.id === 'first' ? Promise.resolve(firstArtwork) : secondArtwork
    });

    await controller.syncDisplayedArtwork(item('first'));
    expect(controller.getSnapshot().displayedArtwork).toBe(firstArtwork);

    const switching = controller.syncDisplayedArtwork(item('second'));
    expect(controller.getSnapshot().displayedArtwork).toBe(firstArtwork);

    resolveSecondArtwork(null);
    await switching;
    expect(controller.getSnapshot().displayedArtwork).toBeNull();
    controller.destroy();
  });

  it('clears stale displayed artwork when the next artwork load fails', async () => {
    const firstArtwork: LoadedStreamArtwork = {
      url: 'blob:first',
      mediaImage: { src: 'blob:first' }
    };
    const controller = createArtworkPresentationController({
      resolveTrackSnapshot: (track) => track,
      isPlaybackDetailsPending: () => false,
      loadArtwork: (track) => track?.id === 'first'
        ? Promise.resolve(firstArtwork)
        : Promise.reject(new Error('unreadable file'))
    });

    await controller.syncDisplayedArtwork(item('first'));
    await controller.syncDisplayedArtwork(item('second'));

    expect(controller.getSnapshot().displayedArtwork).toBeNull();
    controller.destroy();
  });

  it('reloads artwork for the same track when its external artwork key changes', async () => {
    let artworkVersion = 'missing';
    const controller = createArtworkPresentationController({
      resolveTrackSnapshot: (track) => track,
      isPlaybackDetailsPending: () => false,
      getArtworkLoadKey: (track) => track ? `${track.id}:${artworkVersion}` : '',
      loadArtwork: () => Promise.resolve(artworkVersion === 'missing'
        ? null
        : {
            url: `data:image/webp;base64,${artworkVersion}`,
            mediaImage: { src: `data:image/webp;base64,${artworkVersion}` }
          })
    });
    const track = item('remote');

    await controller.syncDisplayedArtwork(track);
    expect(controller.getSnapshot().displayedArtwork).toBeNull();

    artworkVersion = 'received';
    await controller.syncDisplayedArtwork(track);
    expect(controller.getSnapshot().displayedArtwork?.url).toBe('data:image/webp;base64,received');
    controller.destroy();
  });
});
