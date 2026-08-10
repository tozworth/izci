import { describe, expect, it } from 'vitest';
import {
  RENDER_INIT_CLUSTER_INDEX,
  decodeRenderFrame,
  encodeRenderFrame
} from './multiplayer-render-transfer';

describe('render frame framing', () => {
  it('round-trips a fragment', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const frame = encodeRenderFrame({
      renderId: 'render-abc',
      epoch: 7,
      clusterIndex: 42,
      fragmentOffset: 16_384,
      fragmentLength: 5
    }, payload);
    const decoded = decodeRenderFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.renderId).toBe('render-abc');
    expect(decoded!.epoch).toBe(7);
    expect(decoded!.clusterIndex).toBe(42);
    expect(decoded!.fragmentOffset).toBe(16_384);
    expect(decoded!.fragmentLength).toBe(5);
    expect(new Uint8Array(decoded!.payload)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('encodes the init marker cluster index', () => {
    const frame = encodeRenderFrame({
      renderId: 'r',
      epoch: 0,
      clusterIndex: RENDER_INIT_CLUSTER_INDEX,
      fragmentOffset: 0,
      fragmentLength: 2
    }, new Uint8Array([9, 9]).buffer);
    const decoded = decodeRenderFrame(frame);
    expect(decoded!.clusterIndex).toBe(RENDER_INIT_CLUSTER_INDEX);
  });

  it('rejects truncated or malformed frames', () => {
    expect(decodeRenderFrame(new ArrayBuffer(4))).toBeNull();
    const frame = encodeRenderFrame({
      renderId: 'r',
      epoch: 0,
      clusterIndex: 0,
      fragmentOffset: 0,
      fragmentLength: 3
    }, new Uint8Array([1, 2]).buffer);
    expect(decodeRenderFrame(frame)).toBeNull();
  });
});
