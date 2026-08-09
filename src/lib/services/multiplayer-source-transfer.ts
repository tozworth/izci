import type { PlaylistItem } from '$lib/types';
import { logWarning } from '$lib/services/logging';
import type { PeerConnection, SourceFileBeginFrame, SourceFileEndFrame } from './multiplayer-types';

export const SOURCE_FILE_CHUNK_SIZE = 16 * 1024;
export const SOURCE_FILE_QUEUE_LIMIT = 1024 * 1024;

export function queuePeerMedia(peer: PeerConnection, frame: string | ArrayBuffer): void {
  peer.mediaOutgoing.push(frame);
  peer.mediaQueuedBytes += typeof frame === 'string' ? frame.length : frame.byteLength;
  flushPeerMedia(peer);
}

export function flushPeerMedia(peer: PeerConnection): void {
  const channel = peer.mediaChannel;
  if (peer.mediaFlushing || !channel || channel.readyState !== 'open') return;
  peer.mediaFlushing = true;
  const flush = () => {
    const activeChannel = peer.mediaChannel;
    if (!activeChannel || activeChannel.readyState !== 'open') {
      peer.mediaFlushing = false;
      return;
    }
    while (peer.mediaOutgoing.length > 0 && activeChannel.bufferedAmount < 512_000) {
      const frame = peer.mediaOutgoing[0];
      try {
        if (typeof frame === 'string') activeChannel.send(frame);
        else activeChannel.send(frame);
      } catch (error) {
        peer.mediaFlushing = false;
        logWarning('multiplayer', 'Media-channel send failed; transfer will resume after reconnect', {
          peerId: peer.id,
          error
        });
        activeChannel.close();
        peer.pc.close();
        return;
      }
      peer.mediaOutgoing.shift();
      peer.mediaQueuedBytes = Math.max(
        0,
        peer.mediaQueuedBytes - (typeof frame === 'string' ? frame.length : frame.byteLength)
      );
    }
    peer.mediaFlushing = false;
    if (peer.mediaOutgoing.length > 0 && activeChannel.bufferedAmount < 512_000) {
      flushPeerMedia(peer);
    }
  };
  flush();
}

export function waitForMediaQueue(peer: PeerConnection, token: number): Promise<void> {
  if (peer.mediaQueuedBytes < SOURCE_FILE_QUEUE_LIMIT || peer.mediaTransferToken !== token) {
    return Promise.resolve();
  }
  return new Promise((resolve) => window.setTimeout(resolve, 10));
}

export async function transferSourceFile(
  peer: PeerConnection,
  track: PlaylistItem,
  file: File,
  token: number,
  generationId: string
): Promise<void> {
  const transferId = crypto.randomUUID();
  queuePeerMedia(peer, JSON.stringify({
    kind: 'file.begin',
    transferId,
    trackId: track.id,
    generationId,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  } satisfies SourceFileBeginFrame));

  let failure: unknown = null;
  try {
    for (let offset = 0; offset < file.size; offset += SOURCE_FILE_CHUNK_SIZE) {
      if (peer.mediaTransferToken !== token || peer.mediaChannel?.readyState !== 'open') return;
      while (peer.mediaQueuedBytes >= SOURCE_FILE_QUEUE_LIMIT) {
        await waitForMediaQueue(peer, token);
        if (peer.mediaTransferToken !== token || peer.mediaChannel?.readyState !== 'open') return;
      }
      const chunk = await file.slice(offset, offset + SOURCE_FILE_CHUNK_SIZE).arrayBuffer();
      if (peer.mediaTransferToken !== token) return;
      queuePeerMedia(peer, chunk);
    }
  } catch (error) {
    failure = error;
  }
  if (peer.mediaTransferToken !== token) return;
  queuePeerMedia(peer, JSON.stringify({ kind: 'file.end', transferId } satisfies SourceFileEndFrame));
  if (failure) throw failure;
}

export function parseSourceFileFrame(value: string): SourceFileBeginFrame | SourceFileEndFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const frame = parsed as Record<string, unknown>;
  if (frame.kind === 'file.end') {
    return typeof frame.transferId === 'string' ? { kind: 'file.end', transferId: frame.transferId } : null;
  }
  if (frame.kind !== 'file.begin'
    || typeof frame.transferId !== 'string'
    || typeof frame.trackId !== 'string'
    || typeof frame.generationId !== 'string'
    || frame.generationId.length < 1
    || frame.generationId.length > 80
    || typeof frame.name !== 'string'
    || typeof frame.type !== 'string'
    || typeof frame.size !== 'number'
    || !Number.isSafeInteger(frame.size)
    || frame.size < 0
    || typeof frame.lastModified !== 'number'
    || !Number.isFinite(frame.lastModified)) return null;
  return {
    kind: 'file.begin',
    transferId: frame.transferId,
    trackId: frame.trackId,
    generationId: frame.generationId,
    name: frame.name,
    type: frame.type,
    size: frame.size,
    lastModified: frame.lastModified
  };
}
