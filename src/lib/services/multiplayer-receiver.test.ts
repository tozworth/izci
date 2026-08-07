import { describe, expect, it } from 'vitest';
import {
  estimateReceiverPlayoutLevelMs,
  setMultiplayerReceiverBuffer
} from './multiplayer-receiver';

describe('multiplayer receiver buffering', () => {
  it('sets the standardized jitter buffer target in milliseconds', () => {
    const receiver = { jitterBufferTarget: null } as unknown as RTCRtpReceiver;

    expect(setMultiplayerReceiverBuffer(receiver, 750)).toBe(true);
    expect(receiver.jitterBufferTarget).toBe(750);
  });

  it('bounds the native target to the WebRTC maximum', () => {
    const receiver = { jitterBufferTarget: null } as unknown as RTCRtpReceiver;

    setMultiplayerReceiverBuffer(receiver, 9_000);
    expect(receiver.jitterBufferTarget).toBe(4_000);
  });

  it('falls back to the legacy Chromium hint in seconds', () => {
    const receiver = { playoutDelayHint: null } as unknown as RTCRtpReceiver;

    expect(setMultiplayerReceiverBuffer(receiver, 1_250)).toBe(true);
    expect((receiver as unknown as { playoutDelayHint: number }).playoutDelayHint).toBe(1.25);
  });

  it('estimates the current playout level from the delta between two samples', () => {
    // 200 ms window at 48 kHz = 9_600 samples, each held ~100 ms →
    // Δdelay = 9600 × 0.1 s = 960 s of cumulative delay.
    const level = estimateReceiverPlayoutLevelMs(
      { delay: 1_960, emitted: 57_600 },
      { delay: 1_000, emitted: 48_000 }
    );
    expect(level).toBeCloseTo(100, 5);
  });

  it('tracks the current level instead of the lifetime average during a build', () => {
    // Simulate a cushion build: samples emitted early (low delay) keep the
    // lifetime average far below the current level, but the delta sees the
    // current ~600 ms hold (4_800 samples at 48 kHz × 0.6 s = 2_880 s).
    const level = estimateReceiverPlayoutLevelMs(
      { delay: 10_880, emitted: 100_800 },
      { delay: 8_000, emitted: 96_000 }
    );
    expect(level).toBeCloseTo(600, 5);
    // Lifetime average for comparison: (10880 / 100800) * 1000 ≈ 108 ms.
    expect((10_880 / 100_800) * 1000).toBeLessThan(level);
  });

  it('returns 0 without a previous sample or without emission progress', () => {
    expect(estimateReceiverPlayoutLevelMs({ delay: 1, emitted: 100 }, null)).toBe(0);
    expect(estimateReceiverPlayoutLevelMs(
      { delay: 2, emitted: 100 },
      { delay: 1, emitted: 100 }
    )).toBe(0);
  });
});
