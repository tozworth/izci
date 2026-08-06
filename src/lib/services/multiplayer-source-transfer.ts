import type { PlaylistItem } from '$lib/types';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';
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
      const frame = peer.mediaOutgoing.shift()!;
      peer.mediaQueuedBytes = Math.max(
        0,
        peer.mediaQueuedBytes - (typeof frame === 'string' ? frame.length : frame.byteLength)
      );
      if (typeof frame === 'string') activeChannel.send(frame);
      else activeChannel.send(frame);
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
  token: number
): Promise<void> {
  const transferId = crypto.randomUUID();
  logInfo('multiplayer', 'Source file transfer started', {
    trackId: track.id,
    name: file.name,
    bytes: file.size
  });
  queuePeerMedia(peer, JSON.stringify({
    kind: 'file.begin',
    transferId,
    trackId: track.id,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  } satisfies SourceFileBeginFrame));

  for (let offset = 0; offset < file.size; offset += SOURCE_FILE_CHUNK_SIZE) {
    if (peer.mediaTransferToken !== token || peer.mediaChannel?.readyState !== 'open') {
      logWarning('multiplayer', 'Source file transfer aborted', {
        name: file.name,
        offset
      });
      return;
    }
    while (peer.mediaQueuedBytes >= SOURCE_FILE_QUEUE_LIMIT) {
      await waitForMediaQueue(peer, token);
      if (peer.mediaTransferToken !== token || peer.mediaChannel?.readyState !== 'open') {
        logWarning('multiplayer', 'Source file transfer aborted (queue wait)', {
          name: file.name
        });
        return;
      }
    }
    const chunk = await file.slice(offset, offset + SOURCE_FILE_CHUNK_SIZE).arrayBuffer();
    if (peer.mediaTransferToken !== token) {
      logDebug('multiplayer', 'Source file transfer superseded', { name: file.name });
      return;
    }
    queuePeerMedia(peer, chunk);
  }
  if (peer.mediaTransferToken !== token) {
    logDebug('multiplayer', 'Source file transfer superseded before completion', { name: file.name });
    return;
  }
  queuePeerMedia(peer, JSON.stringify({ kind: 'file.end', transferId } satisfies SourceFileEndFrame));
  logInfo('multiplayer', 'Source file transfer completed', {
    name: file.name,
    bytes: file.size
  });
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
    name: frame.name,
    type: frame.type,
    size: frame.size,
    lastModified: frame.lastModified
  };
}
