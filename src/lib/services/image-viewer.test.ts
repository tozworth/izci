import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackSnapshot, TrackItem, TrackMetadata } from '$lib/types';
import { ImageViewerService } from './image-viewer';

class FakeImage {
  alt = '';
  decoding = '';
  draggable = true;
  naturalWidth = 2048;
  naturalHeight = 1365;
  #listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void): void {
    this.#listeners.set(type, listener);
  }

  removeAttribute(): void {}

  set src(_value: string) {
    queueMicrotask(() => this.#listeners.get('load')?.());
  }
}

function imageTrack(): TrackItem {
  return {
    id: 'image',
    name: 'image.webp',
    extension: 'webp',
    kind: 'image',
    size: 1,
    lastModified: 1,
    objectUrl: 'blob:image'
  };
}

beforeEach(() => vi.stubGlobal('Image', FakeImage));
afterEach(() => vi.unstubAllGlobals());

describe('image viewer', () => {
  it('uses one lazily-created element for display and dimension metadata', async () => {
    const snapshots: Array<Partial<PlaybackSnapshot>> = [];
    const metadata: TrackMetadata[] = [];
    const viewer = new ImageViewerService(
      (value) => snapshots.push(value),
      (value) => metadata.push(value)
    );

    expect(viewer.element).toBeNull();
    await viewer.load(imageTrack());

    expect(viewer.element).toBeInstanceOf(FakeImage);
    expect(metadata).toEqual([{ width: 2048, height: 1365 }]);
    expect(snapshots.at(-1)).toMatchObject({ state: 'paused' });
  });
});
