import { describe, expect, it, vi } from 'vitest';
import type { PeerConnection } from './multiplayer-types';
import { flushPeer } from './multiplayer-peer';

describe('multiplayer control sending', () => {
  it('closes a failed channel without dropping the unsent frame or wedging the queue', () => {
    const close = vi.fn();
    const peer = {
      id: 'peer',
      channel: {
        readyState: 'open',
        bufferedAmount: 0,
        send: () => { throw new Error('send failed'); },
        close
      },
      outgoing: ['frame'],
      flushing: false
    } as unknown as PeerConnection;

    expect(() => flushPeer(peer)).not.toThrow();
    expect(peer.flushing).toBe(false);
    expect(peer.outgoing).toEqual(['frame']);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
