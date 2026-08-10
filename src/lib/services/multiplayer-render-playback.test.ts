import { describe, expect, it } from 'vitest';
import type { MultiplayerPlayback } from './multiplayer-protocol';
import type { PlaybackSnapshot } from '$lib/types';
import {
  contiguousMsAtPosition,
  expectedPositionMs,
  hasRequiredRenderWindow,
  hasTimelineDiscontinuity,
  renderGapRecoveryTargetMs,
  renderStallRecoveryNeeded
} from './multiplayer-render-playback';

type PlaybackPatch = Partial<Omit<MultiplayerPlayback, 'snapshot'>> & {
  snapshot?: Partial<PlaybackSnapshot>;
};

function playback(partial: PlaybackPatch): MultiplayerPlayback {
  return {
    generationId: 'gen-1',
    track: { id: 'track-1' } as MultiplayerPlayback['track'],
    sentAt: Date.now(),
    ...partial,
    snapshot: {
      state: 'paused',
      currentTime: 0,
      duration: 0,
      volume: 1,
      muted: false,
      backend: null,
      ...(partial.snapshot ?? {})
    }
  } as MultiplayerPlayback;
}

describe('expectedPositionMs', () => {
  it('returns currentTime when not playing', () => {
    const p = playback({ snapshot: { state: 'paused', currentTime: 12.5 } });
    expect(expectedPositionMs(p)).toBe(12_500);
  });

  it('adds wall-clock elapsed while playing, capped at duration', () => {
    const p = playback({
      sentAt: Date.now() - 2_000,
      snapshot: { state: 'playing', currentTime: 5, duration: 10 }
    });
    expect(expectedPositionMs(p)).toBeCloseTo(7_000, 0);
  });

  it('caps at duration', () => {
    const p = playback({
      sentAt: Date.now() - 10_000,
      snapshot: { state: 'playing', currentTime: 8, duration: 10 }
    });
    expect(expectedPositionMs(p)).toBeCloseTo(10_000, 0);
  });
});

describe('hasTimelineDiscontinuity', () => {
  it('ignores same-track position creep', () => {
    const previous = playback({ snapshot: { state: 'playing', currentTime: 10 } });
    const next = playback({ snapshot: { state: 'playing', currentTime: 10.4 } });
    expect(hasTimelineDiscontinuity(previous, next)).toBe(false);
  });

  it('detects a generation change', () => {
    const previous = playback({ snapshot: { state: 'playing', currentTime: 10 } });
    const next = playback({ generationId: 'gen-2', snapshot: { state: 'playing', currentTime: 10 } });
    expect(hasTimelineDiscontinuity(previous, next)).toBe(true);
  });

  it('detects a large position jump', () => {
    const previous = playback({ snapshot: { state: 'playing', currentTime: 10 } });
    const next = playback({ snapshot: { state: 'playing', currentTime: 55 } });
    expect(hasTimelineDiscontinuity(previous, next)).toBe(true);
  });
});

describe('contiguousMsAtPosition', () => {
  it('measures the window ahead of a position inside a range', () => {
    expect(contiguousMsAtPosition([{ start: 1_000, end: 5_000 }], 2_000)).toBe(3_000);
    expect(contiguousMsAtPosition([{ start: 0, end: 0 }], 0)).toBe(0);
    expect(contiguousMsAtPosition([], 0)).toBe(0);
  });
});

describe('hasRequiredRenderWindow', () => {
  it('waits for the configured startup window when enough track remains', () => {
    expect(hasRequiredRenderWindow(2_999, 3_000, 30_000)).toBe(false);
    expect(hasRequiredRenderWindow(3_000, 3_000, 30_000)).toBe(true);
  });

  it('waits for the entire remainder near the end of a track', () => {
    expect(hasRequiredRenderWindow(0, 3_000, 1_000)).toBe(false);
    expect(hasRequiredRenderWindow(999, 3_000, 1_000)).toBe(false);
    expect(hasRequiredRenderWindow(1_000, 3_000, 1_000)).toBe(true);
  });

  it('treats the exact end of the track as ready', () => {
    expect(hasRequiredRenderWindow(0, 3_000, 0)).toBe(true);
  });
});

describe('renderStallRecoveryNeeded', () => {
  const base = {
    ready: false,
    hasManifest: true,
    initAppended: true,
    hasInitBytes: true,
    nextAppendIndex: 0,
    clusterCount: 233,
    lastProgressAgeMs: 60_000,
    graceMs: 2_500
  };

  it('does nothing while ready or before the manifest', () => {
    expect(renderStallRecoveryNeeded({
      ...base,
      ready: true,
      received: new Map([[0, new Uint8Array(1)]])
    })).toBe(false);
    expect(renderStallRecoveryNeeded({
      ...base,
      hasManifest: false,
      received: new Map()
    })).toBe(false);
  });

  it('recovers when the init never arrived', () => {
    expect(renderStallRecoveryNeeded({
      ...base,
      initAppended: false,
      hasInitBytes: false,
      received: new Map()
    })).toBe(true);
  });

  it('gives a requested init a full grace window', () => {
    expect(renderStallRecoveryNeeded({
      ...base,
      initAppended: false,
      hasInitBytes: false,
      received: new Map(),
      lastProgressAgeMs: 200
    })).toBe(false);
  });

  it('recovers when early clusters are missing (the drained gap)', () => {
    // Received 26..232 but the ascending drain is stuck at index 0: the
    // phone-verified stall behind the perma throbber.
    const received = new Map<number, Uint8Array>();
    for (let index = 26; index <= 232; index += 1) received.set(index, new Uint8Array(1));
    expect(renderStallRecoveryNeeded({
      ...base,
      received
    })).toBe(true);
  });

  it('recovers when nothing was ever sent by the host', () => {
    expect(renderStallRecoveryNeeded({
      ...base,
      received: new Map()
    })).toBe(true);
  });

  it('does not fire while appends keep progressing', () => {
    // Drain at 26 with clusters 27+ in flight: the transfer is alive.
    const received = new Map<number, Uint8Array>();
    for (let index = 0; index <= 25; index += 1) received.set(index, new Uint8Array(1));
    for (let index = 27; index <= 60; index += 1) received.set(index, new Uint8Array(1));
    expect(renderStallRecoveryNeeded({
      ...base,
      nextAppendIndex: 26,
      received,
      lastProgressAgeMs: 200
    })).toBe(false);
  });

  it('does not fire after the drain consumed everything present', () => {
    const received = new Map<number, Uint8Array>();
    for (let index = 0; index <= 232; index += 1) received.set(index, new Uint8Array(1));
    expect(renderStallRecoveryNeeded({
      ...base,
      nextAppendIndex: 233,
      received,
      lastProgressAgeMs: 10_000
    })).toBe(false);
  });
});

describe('renderGapRecoveryTargetMs', () => {
  const times = [0, 1_000, 2_000, 3_000, 232_000];

  it('targets the first missing cluster', () => {
    expect(renderGapRecoveryTargetMs(0, times, 1_000)).toBe(0);
    expect(renderGapRecoveryTargetMs(2, times, 1_000)).toBe(2_000);
  });

  it('falls back past the end of the track', () => {
    expect(renderGapRecoveryTargetMs(5, times, 42_000)).toBe(42_000);
    expect(renderGapRecoveryTargetMs(5, [], 42_000)).toBe(42_000);
  });
});
