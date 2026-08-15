import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import {
  buildTroubadourBatchContext,
  detachTrackForMetadataWrite,
  readTroubadourBatchResult,
  readTroubadourWritePreparationRequest,
  respondToTroubadourBatchContextRequest
} from './troubadour-sync';

afterEach(() => {
  vi.unstubAllGlobals();
});

function track(id: string, path: string): TrackItem {
  return {
    id,
    path,
    name: 'Track.flac',
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 10,
    metadata: { title: 'Track' }
  };
}

describe('Troubadour main-window synchronization', () => {
  it('coalesces the same file while retaining every collection reference', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'context-id' });

    const context = buildTroubadourBatchContext([
      { collection: 'current', items: [track('playing', 'Music/Track.flac')] },
      { collection: 'queue', items: [track('queue-copy', 'Music\\Track.flac')] },
      { collection: 'library', items: [track('library-copy', 'Music/Track.flac')] }
    ], []);

    expect(context.tracks).toHaveLength(1);
    expect(context.tracks[0]).toMatchObject({ contextId: 'context-id', path: 'Music/Track.flac' });
    expect(context.tracks[0].references).toEqual([
      { collection: 'current', id: 'playing' },
      { collection: 'queue', id: 'queue-copy' },
      { collection: 'library', id: 'library-copy' }
    ]);
  });

  it('only exchanges context and results with the managed same-origin popup', () => {
    const postMessage = vi.fn();
    const popup = { postMessage } as unknown as Window;
    const impostor = { postMessage: vi.fn() } as unknown as Window;
    vi.stubGlobal('window', { location: { origin: 'https://izci.test' } });

    const handled = respondToTroubadourBatchContextRequest({
      origin: 'https://izci.test',
      source: popup,
      data: { type: 'izci:troubadour:request-batch-context' }
    } as unknown as MessageEvent, popup, { tracks: [], rememberedFolders: [] });

    expect(handled).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'izci:troubadour:batch-context',
      context: { tracks: [], rememberedFolders: [] }
    }, 'https://izci.test');
    expect(readTroubadourBatchResult({
      origin: 'https://izci.test',
      source: impostor,
      data: { type: 'izci:troubadour:batch-result', result: { results: [] } }
    } as unknown as MessageEvent, popup)).toBeNull();
  });

  it('recognizes write preparation requests only from the managed popup', () => {
    const popup = {} as Window;
    vi.stubGlobal('window', { location: { origin: 'https://izci.test' } });
    const request = readTroubadourWritePreparationRequest({
      origin: 'https://izci.test',
      source: popup,
      data: {
        type: 'izci:troubadour:prepare-write',
        requestId: 'write-1',
        targets: [{ originalPath: 'Music/Track.flac', originalSize: 100 }]
      }
    } as unknown as MessageEvent, popup);

    expect(request).toEqual({
      requestId: 'write-1',
      targets: [{
        references: undefined,
        contextId: undefined,
        originalPath: 'Music/Track.flac',
        originalName: undefined,
        originalSize: 100,
        originalLastModified: undefined,
        originalFileHandle: undefined
      }]
    });
  });

  it('moves active media playback onto a memory-backed object URL before writing', async () => {
    const createObjectURL = vi.fn(() => 'blob:memory-copy');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const source = new File([new Uint8Array([1, 2, 3])], 'Track.flac', {
      type: 'audio/flac',
      lastModified: 10
    });
    const activeTrack = { ...track('playing', 'Music/Track.flac'), file: source, objectUrl: 'blob:disk-file' };
    const loadTrack = vi.fn(async (
      _track: TrackItem,
      _options: { autoPlay: boolean; initialPosition: number }
    ) => undefined);

    await expect(detachTrackForMetadataWrite(
      activeTrack,
      { autoPlay: false, initialPosition: 2.35 },
      loadTrack
    )).resolves.toBe(true);

    const detachedTrack = loadTrack.mock.calls[0][0];
    expect(detachedTrack.file).not.toBe(source);
    await expect(detachedTrack.file!.arrayBuffer()).resolves.toEqual(await source.arrayBuffer());
    expect(detachedTrack.objectUrl).toBe('blob:memory-copy');
    expect(loadTrack).toHaveBeenCalledWith(detachedTrack, { autoPlay: false, initialPosition: 2.35 });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:disk-file');
  });
});
