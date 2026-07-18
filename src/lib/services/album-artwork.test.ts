import { describe, expect, it, vi } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import { createAlbumArtworkController } from './album-artwork';

function item(id: string): PlaylistItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 200
  };
}

describe('album artwork controller', () => {
  it('tries album tracks in order and shares object URLs for deduplicated assets', async () => {
    const blob = new Blob(['thumbnail'], { type: 'image/webp' });
    const loadThumbnail = vi.fn(async (track: PlaylistItem) =>
      track.id === 'missing'
        ? null
        : { assetId: 'shared-cover', blob, width: 96, height: 96 }
    );
    const createObjectUrl = vi.fn(() => 'blob:shared-cover');
    const revokeObjectUrl = vi.fn();
    const controller = createAlbumArtworkController({
      loadThumbnail,
      createObjectUrl,
      revokeObjectUrl
    });
    let urls: Record<string, string> = {};
    controller.subscribe((snapshot) => {
      urls = snapshot;
    });

    controller.sync([
      { key: 'album:one', items: [item('missing'), item('cover-one')] },
      { key: 'album:two', items: [item('cover-two')] }
    ]);

    await vi.waitFor(() => {
      expect(urls).toEqual({
        'album:one': 'blob:shared-cover',
        'album:two': 'blob:shared-cover'
      });
    });
    expect(loadThumbnail.mock.calls.map(([track]) => track.id)).toContain('missing');
    expect(loadThumbnail.mock.calls.map(([track]) => track.id)).toContain('cover-one');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    controller.destroy();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a resolved negative lookup for an unchanged group', async () => {
    const loadThumbnail = vi.fn(async () => null);
    const controller = createAlbumArtworkController({ loadThumbnail });
    const group = { key: 'album:empty', items: [item('missing')] };

    controller.sync([group]);
    await vi.waitFor(() => expect(loadThumbnail).toHaveBeenCalledTimes(1));
    controller.sync([group]);
    await Promise.resolve();

    expect(loadThumbnail).toHaveBeenCalledTimes(1);
    controller.destroy();
  });
});
