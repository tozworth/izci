import { describe, expect, it } from 'vitest';

import {
  createArtworkPresentationController,
  hasSameTrackMetadata,
  resolveTrackSnapshot
} from './artwork-presentation';
import type { LoadedStreamArtwork } from './stream-artwork';
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

  it('does not republish identical selection state on repeat syncs (resize churn)', async () => {
    const controller = createArtworkPresentationController({
      resolveTrackSnapshot: (track) => track,
      isPlaybackDetailsPending: () => false,
      loadArtwork: () => Promise.resolve(null)
    });
    const track = item('track', { metadata: { title: 'One' } });

    // Mirror the app flow: selection first, then the details display commit.
    controller.syncSelection(track, true);
    await controller.syncDetailsDisplay();
    expect(controller.getSnapshot().detailsDisplayTrack).toBe(track);

    let publishCount = 0;
    const unsubscribe = controller.subscribe(() => {
      publishCount += 1;
    });

    controller.syncSelection(track, true);
    controller.syncSelection(track, true);
    controller.syncSelection(track, true);

    // Subscription fires once on subscribe; identical re-syncs must not
    // publish fresh state objects (they would cascade reactive recomputes,
    // e.g. resolving library navigation targets on every window resize).
    expect(publishCount).toBe(1);

    // A newer object with the same id (e.g. metadata edited) still refreshes.
    const updated = item('track', { metadata: { title: 'Two' } });
    controller.syncSelection(updated, true);
    expect(publishCount).toBe(2);
    expect(controller.getSnapshot().detailsDisplayTrack).toBe(updated);

    // A same-id object with IDENTICAL metadata (remote catalog replace) is
    // not a change — it must not republish either.
    const replaced = item('track', { metadata: { title: 'Two' } });
    controller.syncSelection(replaced, true);
    expect(publishCount).toBe(2);
    expect(controller.getSnapshot().detailsDisplayTrack).toBe(updated);

    unsubscribe();
    controller.destroy();
  });
});
