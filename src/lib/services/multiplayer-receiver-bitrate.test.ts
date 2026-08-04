import { describe, expect, it } from 'vitest';
import { updateReceivedBitrateWindow } from './multiplayer-receiver-bitrate';

describe('updateReceivedBitrateWindow', () => {
  it('reports the average receive bitrate over the retained window', () => {
    let window = updateReceivedBitrateWindow([], { timestamp: 0, bytesReceived: 1_000 });
    window = updateReceivedBitrateWindow(window.samples, { timestamp: 1_000, bytesReceived: 17_000 });
    window = updateReceivedBitrateWindow(window.samples, { timestamp: 2_000, bytesReceived: 33_000 });

    expect(window.averageKbps).toBe(128);
  });

  it('drops samples outside the rolling window', () => {
    const previous = [
      { timestamp: 0, bytesReceived: 0 },
      { timestamp: 4_000, bytesReceived: 40_000 }
    ];

    const window = updateReceivedBitrateWindow(
      previous,
      { timestamp: 6_000, bytesReceived: 70_000 },
      5_000
    );

    expect(window.samples).toHaveLength(2);
    expect(window.averageKbps).toBe(120);
  });

  it('starts a fresh window when the receive counter resets', () => {
    const window = updateReceivedBitrateWindow(
      [{ timestamp: 1_000, bytesReceived: 50_000 }],
      { timestamp: 2_000, bytesReceived: 2_000 }
    );

    expect(window.samples).toEqual([{ timestamp: 2_000, bytesReceived: 2_000 }]);
    expect(window.averageKbps).toBeNull();
  });
});
