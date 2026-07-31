import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import {
  buildTroubadourBatchContext,
  readTroubadourBatchResult,
  respondToTroubadourBatchContextRequest
} from './troubadour-sync';

afterEach(() => {
  vi.unstubAllGlobals();
});

function track(id: string, path: string): PlaylistItem {
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
      { collection: 'playlist', items: [track('playlist-copy', 'Music\\Track.flac')] },
      { collection: 'library', items: [track('library-copy', 'Music/Track.flac')] }
    ], []);

    expect(context.tracks).toHaveLength(1);
    expect(context.tracks[0]).toMatchObject({ contextId: 'context-id', path: 'Music/Track.flac' });
    expect(context.tracks[0].references).toEqual([
      { collection: 'current', id: 'playing' },
      { collection: 'playlist', id: 'playlist-copy' },
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
});
