import { describe, expect, it, vi } from 'vitest';
import { flushPeerMedia, parseSourceFileFrame, transferSourceFile } from './multiplayer-source-transfer';
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
      id: 'track', path: 'broken.flac', name: 'broken.flac', format: 'flac', kind: 'stream', size: 10, lastModified: 1
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
});
