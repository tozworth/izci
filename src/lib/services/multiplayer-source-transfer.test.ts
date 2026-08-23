import { describe, expect, it, vi } from 'vitest';
import { syncPeerSourceFile } from './multiplayer-host-freeplay';
import { flushPeerMedia, parseSourceFileFrame, transferSourceFile } from './multiplayer-source-transfer';
import type { MultiplayerHostContext } from './multiplayer-host';
import type { PeerConnection } from './multiplayer-types';

describe('multiplayer source transfer frames', () => {
  it('ties a source file to the delivery generation', () => {
    expect(parseSourceFileFrame(JSON.stringify({
      kind: 'file.begin',
      transferId: 'transfer',
      trackId: 'track',
      generationId: 'generation',
      name: 'track.flac',
      type: 'audio/flac',
      size: 10,
      lastModified: 1
    }))).toMatchObject({ trackId: 'track', generationId: 'generation' });
  });

  it('rejects legacy and unbounded generation-less frames', () => {
    expect(parseSourceFileFrame(JSON.stringify({
      kind: 'file.begin', transferId: 'transfer', trackId: 'track', name: 'track.flac',
      type: 'audio/flac', size: 10, lastModified: 1
    }))).toBeNull();
  });

  it('terminates a failed read so the client can request a bounded retry', async () => {
    const sent: Array<string | ArrayBuffer> = [];
    const channel = {
      readyState: 'open',
      bufferedAmount: 0,
      send: (frame: string | ArrayBuffer) => sent.push(frame)
    } as unknown as RTCDataChannel;
    const peer = {
      mediaChannel: channel,
      mediaOutgoing: [],
      mediaQueuedBytes: 0,
      mediaFlushing: false,
      mediaTransferToken: 1
    } as unknown as PeerConnection;
    const brokenFile = {
      name: 'broken.flac', type: 'audio/flac', size: 10, lastModified: 1,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('read failed')) })
    } as unknown as File;
    const track = {
      id: 'track', name: 'broken.flac', extension: 'flac', kind: 'stream', size: 10, lastModified: 1
    } as const;

    await expect(transferSourceFile(peer, track, brokenFile, 1, 'generation')).rejects.toThrow('read failed');
    expect(sent.filter((frame): frame is string => typeof frame === 'string').map(parseSourceFileFrame))
      .toEqual([
        expect.objectContaining({ kind: 'file.begin', generationId: 'generation' }),
        expect.objectContaining({ kind: 'file.end' })
      ]);
  });

  it('keeps an unsent media frame and closes a failed channel for reconnect', () => {
    const close = vi.fn();
    const closePeer = vi.fn();
    const peer = {
      id: 'peer',
      mediaChannel: {
        readyState: 'open',
        bufferedAmount: 0,
        send: () => { throw new Error('send failed'); },
        close
      },
      mediaOutgoing: ['frame'],
      mediaQueuedBytes: 5,
      mediaFlushing: false,
      pc: { close: closePeer }
    } as unknown as PeerConnection;

    expect(() => flushPeerMedia(peer)).not.toThrow();
    expect(peer.mediaOutgoing).toEqual(['frame']);
    expect(peer.mediaFlushing).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(closePeer).toHaveBeenCalledTimes(1);
  });

  it('invalidates an obsolete source transfer even after its channel closes', () => {
    const peer = {
      id: 'peer',
      mediaChannel: { readyState: 'closed' },
      mediaTransferToken: 4,
      mediaOutgoing: [new ArrayBuffer(8)],
      mediaQueuedBytes: 8,
      sourceTrackKey: 'old-generation:track:10:1'
    } as unknown as PeerConnection;

    syncPeerSourceFile({ core: {} } as MultiplayerHostContext, peer, null, null);

    expect(peer.mediaTransferToken).toBe(5);
    expect(peer.mediaOutgoing).toEqual([]);
    expect(peer.mediaQueuedBytes).toBe(0);
    expect(peer.sourceTrackKey).toBe('');
  });

  it('starts the initial source transfer when its media channel becomes ready', async () => {
    let readyState: RTCDataChannelState = 'connecting';
    const sent: Array<string | ArrayBuffer> = [];
    const channel = {
      get readyState() { return readyState; },
      bufferedAmount: 0,
      send: (frame: string | ArrayBuffer) => sent.push(frame)
    } as unknown as RTCDataChannel;
    const file = new File([new Uint8Array([1, 2, 3])], 'track.flac', {
      type: 'audio/flac',
      lastModified: 1
    });
    const peer = {
      id: 'peer',
      mediaChannel: channel,
      mediaTransferToken: 0,
      mediaOutgoing: [],
      mediaQueuedBytes: 0,
      mediaFlushing: false,
      sourceTrackKey: ''
    } as unknown as PeerConnection;
    const track = {
      id: 'track',
      name: file.name,
      extension: 'flac',
      kind: 'stream',
      size: file.size,
      lastModified: file.lastModified,
      file
    } as const;

    syncPeerSourceFile({ core: {} } as MultiplayerHostContext, peer, track, 'generation');
    expect(peer.sourceTrackKey).toBe('');
    expect(sent).toEqual([]);

    readyState = 'open';
    syncPeerSourceFile({ core: {} } as MultiplayerHostContext, peer, track, 'generation');
    await vi.waitFor(() => {
      expect(sent.filter((frame) => typeof frame === 'string').map((frame) => (
        parseSourceFileFrame(frame as string)?.kind
      ))).toEqual(['file.begin', 'file.end']);
    });

    expect(peer.sourceTrackKey).toBe(`generation:track:${file.size}:${file.lastModified}`);
    expect(peer.mediaTransferToken).toBe(1);

    syncPeerSourceFile({ core: {} } as MultiplayerHostContext, peer, track, 'generation');
    expect(sent.filter((frame) => typeof frame === 'string')).toHaveLength(2);
  });
});
