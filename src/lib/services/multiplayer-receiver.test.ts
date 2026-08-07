import { describe, expect, it } from 'vitest';
import {
  ReceiverCushionTracker,
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

describe('ReceiverCushionTracker', () => {
  it('reports the median of recent samples, ignoring a single spike', () => {
    const tracker = new ReceiverCushionTracker();
    tracker.push(400, 0);
    tracker.push(420, 150);
    // A burst inflates one reading to 900; the median stays at the true level.
    tracker.push(900, 300);
    expect(tracker.levelMs).toBe(420);
  });

  it('does not exit on the stable path before enough samples exist', () => {
    const tracker = new ReceiverCushionTracker();
    tracker.push(600, 0);
    tracker.push(600, 150);
    expect(tracker.isHoldingAtOrAbove(560)).toBe(false);
    tracker.push(600, 300);
    expect(tracker.isHoldingAtOrAbove(560)).toBe(true);
  });

  it('requires the level to HOLD at the target — one spiky sample is not a build', () => {
    const tracker = new ReceiverCushionTracker();
    // Two healthy readings then a burst that crosses the target once.
    tracker.push(300, 0);
    tracker.push(320, 150);
    tracker.push(700, 300);
    // The spike alone must not exit (not three consecutive samples at/above).
    expect(tracker.isHoldingAtOrAbove(560)).toBe(false);
    tracker.push(340, 450);
    expect(tracker.isHoldingAtOrAbove(560)).toBe(false);
  });

  it('plateaus only after the level holds at/above the floor for the window', () => {
    const tracker = new ReceiverCushionTracker();
    const floor = 412;
    const plateauMs = 1500;
    // Climbing below the floor: no plateau.
    tracker.push(200, 0);
    tracker.push(300, 150);
    expect(tracker.isPlateaued(floor, plateauMs, 300)).toBe(false);
    // Cross the floor and age the early lows out of the median window.
    tracker.push(420, 450);
    tracker.push(430, 600);
    tracker.push(440, 750);
    expect(tracker.isPlateaued(floor, plateauMs, 750)).toBe(false);
    // Steady at the floor for the window: plateau fires.
    expect(tracker.isPlateaued(floor, plateauMs, 2250)).toBe(true);
  });

  it('restarts the plateau window when the level drops back below the floor', () => {
    const tracker = new ReceiverCushionTracker();
    const floor = 412;
    const plateauMs = 1500;
    tracker.push(420, 0);
    tracker.push(430, 150);
    expect(tracker.isPlateaued(floor, plateauMs, 150)).toBe(false);
    // A sustained drop below the floor means the build is still in progress.
    tracker.push(250, 300);
    tracker.push(260, 450);
    tracker.push(270, 600);
    expect(tracker.isPlateaued(floor, plateauMs, 600)).toBe(false);
    // Rebuild above the floor and hold for the window.
    tracker.push(420, 750);
    tracker.push(430, 900);
    tracker.push(440, 1050);
    expect(tracker.isPlateaued(floor, plateauMs, 1050)).toBe(false);
    expect(tracker.isPlateaued(floor, plateauMs, 2550)).toBe(true);
  });

  it('restarts the plateau window on meaningful growth', () => {
    const tracker = new ReceiverCushionTracker();
    const floor = 412;
    const plateauMs = 1500;
    tracker.push(420, 0);
    tracker.push(430, 150);
    expect(tracker.isPlateaued(floor, plateauMs, 150)).toBe(false);
    // The level climbs meaningfully (median crosses base + growth): restart.
    tracker.push(490, 300);
    tracker.push(500, 450);
    tracker.push(510, 600);
    expect(tracker.isPlateaued(floor, plateauMs, 600)).toBe(false);
    // Hold at the new level for the window: plateau fires.
    expect(tracker.isPlateaued(floor, plateauMs, 2100)).toBe(true);
  });

  it('keeps the plateau window fresh across small jitter wobble', () => {
    const tracker = new ReceiverCushionTracker();
    const floor = 412;
    const plateauMs = 1500;
    tracker.push(420, 0);
    tracker.push(430, 150);
    // Small wobble (within the growth budget) does not restart the window.
    tracker.push(415, 300);
    tracker.push(425, 450);
    expect(tracker.isPlateaued(floor, plateauMs, 450)).toBe(false);
    expect(tracker.isPlateaued(floor, plateauMs, 1950)).toBe(true);
  });

  it('resets for a fresh build', () => {
    const tracker = new ReceiverCushionTracker();
    tracker.push(700, 0);
    tracker.push(700, 150);
    tracker.push(700, 300);
    expect(tracker.isHoldingAtOrAbove(560)).toBe(true);
    tracker.reset();
    expect(tracker.levelMs).toBe(0);
    expect(tracker.isHoldingAtOrAbove(560)).toBe(false);
  });
});
