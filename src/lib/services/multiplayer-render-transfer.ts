/**
 * Buffered Opus transport: fragment framing for the reliable unordered render
 * channel plus a per-peer send queue (small high-water mark = backpressure).
 */

import { logWarning } from '$lib/services/logging';
import type { PeerConnection } from './multiplayer-types';
import { planRenderClusters } from './multiplayer-render-scheduler';

export const RENDER_FRAGMENT_SIZE = 16 * 1024;
export const RENDER_QUEUE_HIGH_WATER = 512 * 1024;
export const RENDER_INIT_CLUSTER_INDEX = 0xffffffff;

const FRAME_MARKER = 0x52;
const FRAME_HEADER_BASE = 19;

export interface RenderFrameHeader {
  renderId: string;
  epoch: number;
  clusterIndex: number;
  fragmentOffset: number;
  fragmentLength: number;
}

export function encodeRenderFrame(header: RenderFrameHeader, payload: ArrayBuffer): ArrayBuffer {
  const renderIdBytes = new TextEncoder().encode(header.renderId);
  const total = FRAME_HEADER_BASE + renderIdBytes.byteLength + payload.byteLength;
  const frame = new Uint8Array(total);
  const view = new DataView(frame.buffer);
  view.setUint8(0, FRAME_MARKER);
  view.setUint32(1, header.epoch, false);
  view.setUint32(5, header.clusterIndex, false);
  view.setUint32(9, header.fragmentOffset, false);
  view.setUint32(13, header.fragmentLength, false);
  view.setUint16(17, renderIdBytes.byteLength, false);
  frame.set(renderIdBytes, 19);
  frame.set(new Uint8Array(payload), FRAME_HEADER_BASE + renderIdBytes.byteLength);
  return frame.buffer as ArrayBuffer;
}

export function decodeRenderFrame(
  buffer: ArrayBuffer
): (RenderFrameHeader & { payload: ArrayBuffer }) | null {
  if (buffer.byteLength < FRAME_HEADER_BASE + 1) return null;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (view.getUint8(0) !== FRAME_MARKER) return null;
  const renderIdLength = view.getUint16(17, false);
  const headerEnd = FRAME_HEADER_BASE + renderIdLength;
  if (buffer.byteLength < headerEnd) return null;
  let renderId: string;
  try {
    renderId = new TextDecoder().decode(bytes.subarray(FRAME_HEADER_BASE, headerEnd));
  } catch {
    return null;
  }
  if (renderId.length < 1 || renderId.length > 80) return null;
  const epoch = view.getUint32(1, false);
  const clusterIndex = view.getUint32(5, false);
  const fragmentOffset = view.getUint32(9, false);
  const fragmentLength = view.getUint32(13, false);
  if (fragmentLength !== buffer.byteLength - headerEnd) return null;
  return {
    renderId,
    epoch,
    clusterIndex,
    fragmentOffset,
    fragmentLength,
    payload: buffer.slice(headerEnd)
  };
}

export function queueRenderFragments(
  peer: PeerConnection,
  renderId: string,
  epoch: number,
  clusterIndex: number,
  bytes: ArrayBuffer
): void {
  for (let offset = 0; offset < bytes.byteLength; offset += RENDER_FRAGMENT_SIZE) {
    const payload = bytes.slice(offset, offset + RENDER_FRAGMENT_SIZE);
    const frame = encodeRenderFrame({
      renderId,
      epoch,
      clusterIndex,
      fragmentOffset: offset,
      fragmentLength: payload.byteLength
    }, payload);
    peer.renderOutgoing.push(frame);
    peer.renderQueuedBytes += frame.byteLength;
  }
  flushPeerRender(peer);
}

export function flushPeerRender(peer: PeerConnection): void {
  const channel = peer.renderChannel;
  if (peer.renderFlushing || !channel || channel.readyState !== 'open') return;
  peer.renderFlushing = true;
  const flush = () => {
    const activeChannel = peer.renderChannel;
    if (!activeChannel || activeChannel.readyState !== 'open') {
      peer.renderFlushing = false;
      return;
    }
    while (peer.renderOutgoing.length > 0 && activeChannel.bufferedAmount < RENDER_QUEUE_HIGH_WATER) {
      const frame = peer.renderOutgoing[0];
      try {
        activeChannel.send(frame);
      } catch (error) {
        peer.renderFlushing = false;
        logWarning('multiplayer', 'Render-channel send failed; transfer will resume after reconnect', {
          peerId: peer.id,
          error
        });
        activeChannel.close();
        peer.pc.close();
        return;
      }
      peer.renderOutgoing.shift();
      peer.renderQueuedBytes = Math.max(0, peer.renderQueuedBytes - frame.byteLength);
    }
    peer.renderFlushing = false;
    if (peer.renderOutgoing.length > 0 && activeChannel.bufferedAmount < RENDER_QUEUE_HIGH_WATER) {
      flushPeerRender(peer);
    }
  };
  flush();
}

/** Cancels in-flight work for a stale epoch; old frames are dropped client-side. */
export function resetPeerRenderQueue(peer: PeerConnection): void {
  peer.renderOutgoing = [];
  peer.renderQueuedBytes = 0;
  peer.renderFlushing = false;
}

/**
 * Enqueues the next priority batch for a peer. Re-plans on every drain so a
 * seek's new window jumps the queue; the sent set excludes queued clusters.
 */
export function schedulePeerRender(peer: PeerConnection, playheadTimeMs: number): void {
  const state = peer.renderState;
  const channel = peer.renderChannel;
  if (!state || !channel || channel.readyState !== 'open') return;
  const manifest = state.render.manifest;
  if (peer.renderQueuedBytes >= RENDER_QUEUE_HIGH_WATER) return;

  if (!state.initSent) {
    state.initSent = true;
    queueRenderFragments(peer, state.renderId, 0, RENDER_INIT_CLUSTER_INDEX, state.render.init);
  }

  const clusterTimeMs = manifest.clusters.map((cluster) => cluster.timeMs);
  const planned = planRenderClusters({
    clusterTimeMs,
    targetTimeMs: state.targetTimeMs,
    aheadMs: state.aheadMs,
    playheadTimeMs,
    protectionMs: state.protectionMs,
    receivedRanges: state.receivedRanges,
    sent: state.sent
  });
  for (const clusterIndex of planned) {
    if (peer.renderQueuedBytes >= RENDER_QUEUE_HIGH_WATER) break;
    state.sent.add(clusterIndex);
    const cluster = manifest.clusters[clusterIndex];
    const bytes = state.render.clusters[clusterIndex];
    if (!cluster || !bytes) continue;
    queueRenderFragments(peer, state.renderId, state.epoch, clusterIndex, bytes);
  }
}
