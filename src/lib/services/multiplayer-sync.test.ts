import { describe, expect, it } from 'vitest';
import { clientStartTime, estimateMultiplayerClock } from './multiplayer-sync';

describe('multiplayer synchronized playback timing', () => {
  it('estimates clock skew while excluding symmetric network delay', () => {
    const estimate = estimateMultiplayerClock({
      hostSentAt: 1_000,
      clientReceivedAt: 1_080,
      clientSentAt: 1_085,
      hostReceivedAt: 1_105
    });

    expect(estimate.clientOffsetMs).toBe(30);
    expect(estimate.roundTripMs).toBe(100);
    expect(clientStartTime(5_000, estimate.clientOffsetMs)).toBe(5_030);
  });

  it('clamps impossible negative round trips caused by timer granularity', () => {
    expect(estimateMultiplayerClock({
      hostSentAt: 10,
      clientReceivedAt: 20,
      clientSentAt: 30,
      hostReceivedAt: 15
    }).roundTripMs).toBe(0);
  });
});

