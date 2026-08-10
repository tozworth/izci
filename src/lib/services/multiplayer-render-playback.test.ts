import { describe, expect, it } from 'vitest';
import type { MultiplayerPlayback } from './multiplayer-protocol';
import type { PlaybackSnapshot } from '$lib/types';
import {
  contiguousMsAtPosition,
  expectedPositionMs,
  hasRequiredRenderWindow,
  hasTimelineDiscontinuity
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
