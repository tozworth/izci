import { describe, expect, it } from 'vitest';
import { updateMultiplayerPacketLossStats } from './multiplayer-receiver-stats';

describe('updateMultiplayerPacketLossStats', () => {
  it('reports total packet loss from cumulative counters', () => {
    const result = updateMultiplayerPacketLossStats(260, 40);

    expect(result.totalReceived).toBe(260);
    expect(result.totalLost).toBe(40);
    expect(result.totalPercent).toBe(13.33);
  });

  it('reports null percent before any packet traffic', () => {
    const result = updateMultiplayerPacketLossStats(0, 0);

    expect(result.totalReceived).toBe(0);
    expect(result.totalLost).toBe(0);
    expect(result.totalPercent).toBeNull();
  });
});
