import { describe, expect, it } from 'vitest';
import { updateMultiplayerPacketLossStats } from './multiplayer-receiver-stats';

describe('updateMultiplayerPacketLossStats', () => {
  it('reports rolling and total packet loss independently', () => {
    const previous = [
      { timestamp: 0, packetsReceived: 80, packetsLost: 20 },
      { timestamp: 20_000, packetsReceived: 170, packetsLost: 30 }
    ];
    const result = updateMultiplayerPacketLossStats(
      previous,
      { timestamp: 35_000, packetsReceived: 260, packetsLost: 40 }
    );

    expect(result.recentReceived).toBe(90);
    expect(result.recentLost).toBe(10);
    expect(result.recentPercent).toBe(10);
    expect(result.totalPercent).toBe(13.33);
  });

  it('starts a fresh window when counters reset', () => {
    const result = updateMultiplayerPacketLossStats(
      [{ timestamp: 1_000, packetsReceived: 500, packetsLost: 5 }],
      { timestamp: 2_000, packetsReceived: 2, packetsLost: 0 }
    );

    expect(result.samples).toHaveLength(1);
    expect(result.recentPercent).toBeNull();
    expect(result.totalReceived).toBe(2);
  });
});
