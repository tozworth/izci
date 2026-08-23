import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem, TrackMetadata } from '$lib/types';
import { scheduleMetadataParsing } from './queue-metadata';

const metadataHarness = vi.hoisted(() => ({
  loadTrackMetadata: vi.fn<(item: TrackItem) => Promise<TrackMetadata | null>>()
}));

vi.mock('$lib/services/stream-artwork', () => ({
  loadTrackMetadata: metadataHarness.loadTrackMetadata
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => (resolve = next));
  return { promise, resolve };
}

describe('background queue metadata', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    metadataHarness.loadTrackMetadata.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves newer metadata changes when an older parse finishes', async () => {
    const pending = deferred<TrackMetadata | null>();
    metadataHarness.loadTrackMetadata.mockReturnValue(pending.promise);
    let items: TrackItem[] = [{
      id: 'track',
      name: 'Track.flac',
      extension: 'flac',
      kind: 'stream',
      size: 100,
      lastModified: 1,
      metadata: { title: 'Old title' }
    }];

    scheduleMetadataParsing({
      targetItems: items,
      getItemList: () => items,
      updateItems: (updater) => (items = updater(items)),
      queuePersist: vi.fn()
    });
    await vi.advanceTimersByTimeAsync(0);

    items = items.map((item) => ({
      ...item,
      metadata: { ...item.metadata, title: 'Edited title', playCount: 3 }
    }));
    pending.resolve({
      title: 'Parsed title',
      album: 'Parsed album',
      duration: 120,
      embeddedMetadataLoaded: true
    });
    await vi.waitFor(() => expect(items[0].metadata?.album).toBe('Parsed album'));

    expect(items[0].metadata).toMatchObject({
      title: 'Edited title',
      album: 'Parsed album',
      playCount: 3,
      duration: 120,
      embeddedMetadataLoaded: true
    });
  });

  it('discards parse results after the underlying file changes', async () => {
    const pending = deferred<TrackMetadata | null>();
    metadataHarness.loadTrackMetadata.mockReturnValue(pending.promise);
    let items: TrackItem[] = [{
      id: 'track',
      name: 'Track.flac',
      extension: 'flac',
      kind: 'stream',
      size: 100,
      lastModified: 1
    }];

    scheduleMetadataParsing({
      targetItems: items,
      getItemList: () => items,
      updateItems: (updater) => (items = updater(items)),
      queuePersist: vi.fn()
    });
    await vi.advanceTimersByTimeAsync(0);
    items = items.map((item) => ({ ...item, size: 200, lastModified: 2 }));
    pending.resolve({ title: 'Stale title', duration: 120, embeddedMetadataLoaded: true });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(items[0].metadata).toBeUndefined();
  });
});
