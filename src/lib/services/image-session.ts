import { writable } from 'svelte/store';
import type { RepeatMode, TrackItem } from '$lib/types';
import { resolveTrackFile, createTrackMediaUrl } from './file-access';
import { ImageViewerService } from './image-viewer';
import { createQueueNavigation } from '$lib/stores/queue-navigation';
import { resetImagePan } from '$lib/stores/image-pan';
import { resetImageRotation } from '$lib/stores/image-rotation';
import { IMAGE_ZOOM_MIN, videoSettings } from '$lib/stores/video-settings';

export interface ImageSessionSnapshot {
  item: TrackItem | null;
  items: TrackItem[];
  element: HTMLImageElement | null;
  state: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  shuffle: boolean;
  repeatMode: RepeatMode;
}

const defaultDeps = {
  resolveFile: (item: TrackItem) => resolveTrackFile(item, { prompt: true }),
  createUrl: (file: File) => createTrackMediaUrl('image', file),
  revokeUrl: (url: string) => URL.revokeObjectURL(url),
  createViewer: (onState: ConstructorParameters<typeof ImageViewerService>[0],
    onMetadata: ConstructorParameters<typeof ImageViewerService>[1]) => new ImageViewerService(onState, onMetadata),
  resetViewport: () => {
    resetImagePan();
    resetImageRotation();
    if (videoSettings.getSnapshot().imageZoom !== IMAGE_ZOOM_MIN) videoSettings.update({ imageZoom: IMAGE_ZOOM_MIN });
  }
};

/** A transient viewing sequence, independent of the playback queue and transport. */
export function createImageSession(overrides: Partial<typeof defaultDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  let snapshot: ImageSessionSnapshot = {
    item: null, items: [], element: null, state: 'idle', shuffle: false, repeatMode: 'off'
  };
  const store = writable(snapshot);
  const navigation = createQueueNavigation(() => snapshot.items);
  let sequence = 0;
  let ownedUrl: string | undefined;
  let viewer: ImageViewerService | null = null;

  function publish(partial: Partial<ImageSessionSnapshot>): void {
    snapshot = { ...snapshot, ...partial };
    store.set(snapshot);
  }

  function release(): void {
    viewer?.unload();
    viewer = null;
    if (ownedUrl) deps.revokeUrl(ownedUrl);
    ownedUrl = undefined;
  }

  async function show(item: TrackItem): Promise<void> {
    const request = ++sequence;
    release();
    deps.resetViewport();
    publish({ item, element: null, state: 'loading', error: undefined });
    try {
      const file = await deps.resolveFile(item);
      if (request !== sequence) return;
      if (!file) throw new Error('Could not access this file. Re-add it or grant file access.');
      const url = await deps.createUrl(file);
      if (request !== sequence) {
        if (url) deps.revokeUrl(url);
        return;
      }
      if (!url) throw new Error('Could not open this image.');
      ownedUrl = url;
      const loadedItem = { ...item, file, objectUrl: url };
      viewer = deps.createViewer(
        (partial) => {
          if (request === sequence) publish(partial);
        },
        (metadata) => {
          if (request === sequence) publish({ item: { ...loadedItem, metadata: { ...item.metadata, ...metadata } } });
        }
      );
      const loading = viewer.load(loadedItem);
      publish({ element: viewer.element });
      await loading;
    } catch (error) {
      if (request !== sequence) return;
      release();
      publish({ element: null, state: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => snapshot,
    async open(item: TrackItem, sourceItems: readonly TrackItem[] = [item]): Promise<void> {
      if (item.kind !== 'image') return;
      // Capture order and membership at activation. Later library navigation cannot retarget the viewer.
      const items = [...new Map(sourceItems.filter((entry) => entry.kind === 'image').map((entry) => [entry.id, entry])).values()];
      if (!items.some((entry) => entry.id === item.id)) items.push(item);
      navigation.reset();
      publish({ items });
      await show(item);
    },
    async step(direction: -1 | 1): Promise<void> {
      const next = navigation.resolveStepTrack({
        currentId: snapshot.item?.id, direction, shuffle: snapshot.shuffle, wrap: snapshot.repeatMode === 'all'
      });
      if (next && next.id !== snapshot.item?.id) await show(next);
    },
    toggleShuffle(): void {
      navigation.reset();
      publish({ shuffle: !snapshot.shuffle });
    },
    cycleRepeat(): void {
      // Images have no end-of-track event; repeat simply wraps manual navigation.
      publish({ repeatMode: snapshot.repeatMode === 'all' ? 'off' : 'all' });
    },
    close(): void {
      if (!snapshot.item && !viewer) return;
      sequence += 1;
      release();
      navigation.reset();
      publish({ item: null, items: [], element: null, state: 'idle', error: undefined });
    }
  };
}

export const imageSession = createImageSession();
