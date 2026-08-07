interface LegacyPlayoutDelayReceiver {
  playoutDelayHint?: number | null;
}

export interface ReceiverPlayoutSample {
  /** Cumulative seconds the receiver has held emitted samples (jitterBufferDelay). */
  delay: number;
  /** Cumulative count of emitted samples (jitterBufferEmittedCount). */
  emitted: number;
}

/**
 * Estimates the receiver's CURRENT playout level (how far the audible playout
 * lags the incoming stream, in milliseconds) from two cumulative stats samples.
 *
 * The naive `jitterBufferDelay / jitterBufferEmittedCount` is a LIFETIME
 * average: while the level is still building (the preroll cushion build), old
 * low-delay samples drag it far below the current level, so a poll against it
 * never terminates and the wait burns its whole cap. The DELTA over the last
 * window tracks the current level closely: samples emitted during that window
 * were each held for roughly the current level, so
 * `Δdelay / Δemitted × 1000` ≈ current playout lag in milliseconds.
 *
 * Returns 0 when the previous sample is missing (first poll) or the receiver
 * has not emitted anything since (no consumption → level unknown).
 */
export function estimateReceiverPlayoutLevelMs(
  current: ReceiverPlayoutSample,
  previous: ReceiverPlayoutSample | null
): number {
  if (!previous) return 0;
  const dEmitted = current.emitted - previous.emitted;
  const dDelay = current.delay - previous.delay;
  if (dEmitted <= 0 || dDelay <= 0) return 0;
  return (dDelay / dEmitted) * 1000;
}

/**
 * Ask the browser's native WebRTC jitter buffer to favor continuous playout.
 * Chromium's current API uses milliseconds; older Chromium builds exposed the
 * non-standard playoutDelayHint in seconds, so keep that as a best-effort fallback.
 */
export function setMultiplayerReceiverBuffer(
  receiver: RTCRtpReceiver,
  targetMs: number
): boolean {
  const boundedTarget = Math.min(Math.max(Math.round(targetMs), 0), 4_000);

  try {
    if ('jitterBufferTarget' in receiver) {
      receiver.jitterBufferTarget = boundedTarget;
      return true;
    }
  } catch {
    // Fall through to the legacy Chromium hint when the current API rejects a write.
  }

  const legacyReceiver = receiver as RTCRtpReceiver & LegacyPlayoutDelayReceiver;
  try {
    if ('playoutDelayHint' in legacyReceiver) {
      legacyReceiver.playoutDelayHint = boundedTarget / 1_000;
      return true;
    }
  } catch {
    // The browser will retain its adaptive default when neither hint is writable.
  }
  return false;
}
