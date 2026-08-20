/**
 * Pure position/timeline math for the buffered Opus client pipeline, split out
 * of `multiplayer-render-playback.ts` so the timing and stall-recovery rules are
 * unit-testable without a MediaSource/DOM. No I/O, no document access.
 */

import type { MultiplayerPlayback } from './multiplayer-protocol';

/** Rebuffer when the contiguous window ahead of the element falls below this. */
export const REBUFFER_EDGE_MARGIN_MS = 600;
/** Drift above this (while the tab is visible) snaps the element to the host. */
export const DRIFT_CORRECTION_THRESHOLD_MS = 1_000;
/** Cadence for re-applying the host state to a ready, playing pipeline. */
export const BUFFER_MONITOR_INTERVAL_MS = 500;
/** Cadence for re-requesting a stalled startup/gap window. */
export const STALL_CHECK_INTERVAL_MS = 2_500;

export function expectedPositionMs(playback: MultiplayerPlayback): number {
  const elapsed = playback.snapshot.state === 'playing'
    ? Math.max(0, (Date.now() - playback.sentAt))
    : 0;
  const durationMs = playback.snapshot.duration > 0
    ? playback.snapshot.duration * 1_000
    : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(playback.snapshot.currentTime * 1_000 + elapsed, 0), durationMs);
}

export function hasTimelineDiscontinuity(
  previous: MultiplayerPlayback,
  next: MultiplayerPlayback
): boolean {
  if (!previous.track || !next.track || previous.track.id !== next.track.id) return false;
  if (previous.generationId !== next.generationId) return true;
  return Math.abs(expectedPositionMs(previous) - expectedPositionMs(next)) > 1_000;
}

export function contiguousMsAtPosition(
  ranges: Array<{ start: number; end: number }>,
  positionMs: number
): number {
  for (const range of ranges) {
    if (positionMs >= range.start && positionMs <= range.end) {
      return range.end - positionMs;
    }
  }
  return 0;
}

export function hasRequiredRenderWindow(
  windowMs: number,
  desiredMs: number,
  remainingMs: number
): boolean {
  return Math.max(0, windowMs) >= Math.min(
    Math.max(0, desiredMs),
    Math.max(0, remainingMs)
  );
}

/**
 * Whether the append pipeline needs a gap re-request.
 *
 * The drain appends clusters strictly ascending from #nextAppendIndex, so an
 * unfilled early hole strands later received clusters forever (no readiness,
 * permanent throbber). A re-request is warranted only when appends have made
 * NO progress for the grace window AND the drain cannot advance (the missing
 * next cluster, or the init itself never arrived). A healthy transfer keeps
 * appending every few hundred ms, while each request resets the grace window
 * so a slow response is not repeatedly invalidated by newer epochs.
 */
export function renderStallRecoveryNeeded(input: {
  ready: boolean;
  hasManifest: boolean;
  initAppended: boolean;
  hasInitBytes: boolean;
  received: ReadonlyMap<number, unknown>;
  nextAppendIndex: number;
  clusterCount: number;
  lastProgressAgeMs: number;
  graceMs: number;
}): boolean {
  if (input.ready || !input.hasManifest) return false;
  // Appends progressed or a window was requested recently: let that work
  // finish before replacing its epoch and discarding partial fragments.
  if (input.lastProgressAgeMs < input.graceMs) return false;
  // The init itself never arrived: nothing can append.
  if (!input.initAppended && !input.hasInitBytes) return true;
  // Nothing left to drain.
  if (input.nextAppendIndex >= input.clusterCount) return false;
  return !input.received.has(input.nextAppendIndex);
}

/**
 * Re-request target for a stalled append drain: the time of the first missing
 * cluster (the gap), falling back to the current playhead past the end.
 */
export function renderGapRecoveryTargetMs(
  nextAppendIndex: number,
  clusterTimeMs: number[],
  fallbackMs: number
): number {
  return nextAppendIndex < clusterTimeMs.length
    ? clusterTimeMs[nextAppendIndex]
    : Math.max(0, fallbackMs);
}
