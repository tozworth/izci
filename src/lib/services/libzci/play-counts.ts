/**
 * Svelte-side boundary for core play-count observation.
 *
 * The shared session (`libzci::play_counts`) accrues credit from consumed
 * output media frames; SQL owns the resulting user facts through
 * `ProfilePlayback.sync_playback`. This module pins the `PlayCountSnapshot`
 * shape published on engine snapshots (as consumed by the crude
 * `normalizationView`) so the future Svelte owner worker can surface pending
 * qualifications and persistence outages without owning policy.
 *
 * Nothing here writes settings, acknowledges plays, or starts timers.
 */

export interface CorePlayCountSnapshotSettings {
  enabled: boolean;
  threshold_seconds: number;
}

export interface CorePlayCountSnapshot {
  settings?: CorePlayCountSnapshotSettings;
  credited_seconds: number;
  pending: number;
  overflowed: number;
}

export const PLAY_COUNTS_MAX_PENDING = 64;
export const PLAY_COUNTS_MAX_THRESHOLD = 3_600;
export const PLAY_COUNTS_MAX_ID = 9_007_199_254_740_991;

function isSafeNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Validate a play-count snapshot before feeding it to Svelte stores. */
export function validatePlayCountSnapshot(snapshot: CorePlayCountSnapshot): void {
  if (snapshot.settings !== undefined) {
    if (typeof snapshot.settings.enabled !== 'boolean') {
      throw new Error('Invalid play-count settings enabled: expected boolean');
    }
    if (
      !Number.isSafeInteger(snapshot.settings.threshold_seconds) ||
      snapshot.settings.threshold_seconds < 1 ||
      snapshot.settings.threshold_seconds > PLAY_COUNTS_MAX_THRESHOLD
    ) {
      throw new Error(`Invalid play-count threshold: ${String(snapshot.settings.threshold_seconds)}`);
    }
  }
  if (typeof snapshot.credited_seconds !== 'number' || !Number.isFinite(snapshot.credited_seconds) || snapshot.credited_seconds < 0) {
    throw new Error(`Invalid play-count credited_seconds: ${String(snapshot.credited_seconds)}`);
  }
  if (!isSafeNonNegative(snapshot.pending) || snapshot.pending > PLAY_COUNTS_MAX_PENDING) {
    throw new Error(`Invalid play-count pending: ${String(snapshot.pending)}`);
  }
  if (!isSafeNonNegative(snapshot.overflowed) || snapshot.overflowed > PLAY_COUNTS_MAX_ID) {
    throw new Error(`Invalid play-count overflowed: ${String(snapshot.overflowed)}`);
  }
}

/** True when qualifications await durable acknowledgment. */
export function hasPendingPlayCounts(snapshot: CorePlayCountSnapshot): boolean {
  return snapshot.pending > 0;
}

/** True when a persistence outage skipped qualifications visibly. */
export function hasSkippedPlayCounts(snapshot: CorePlayCountSnapshot): boolean {
  return snapshot.overflowed > 0;
}
