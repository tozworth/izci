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

export interface ReceiverCushionSample {
  /** Smoothed playout level estimate (ms) at this sample. */
  levelMs: number;
  /** Wall-clock time of the sample (ms). */
  atMs: number;
}

/**
 * Decides when the preroll cushion build has genuinely converged. All
 * decisions use the MEDIAN of the recent delta estimates, so a single spiky
 * reading (a network burst) or a dip can never end the build early, and
 * exits require the level to HOLD at/above its threshold — never just touch
 * it. This matters most on real-world links: jitter makes consecutive
 * `estimateReceiverPlayoutLevelMs` readings noisy, and the old single-sample
 * exits would route the audible stream with far less than the configured
 * cushion, leaving NetEq to time-stretch the AUDIBLE start of the track
 * toward the target ("nothing for the first seconds, then slowly stutters to
 * life").
 *
 * `atMs`/`nowMs` are injected per call so tests can drive time deterministically.
 */
export class ReceiverCushionTracker {
  #samples: ReceiverCushionSample[] = [];
  readonly #size: number;
  // Plateau bookkeeping: the build is "plateaued" once the level has stayed
  // at/above the floor for `plateauMs` while growing by less than `growthMs`.
  // Dropping below the floor (still climbing) or a meaningful rise (still
  // growing) both restart the window.
  #plateauBaseMs: number | null = null;
  #plateauSinceMs = 0;

  constructor(size = 5) {
    this.#size = Math.max(3, size);
  }

  /** Median of the recent delta estimates (0 before any sample). */
  get levelMs(): number {
    if (this.#samples.length === 0) return 0;
    const sorted = this.#samples.map((sample) => sample.levelMs).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  push(levelMs: number, atMs: number): number {
    this.#samples.push({ levelMs, atMs });
    if (this.#samples.length > this.#size) this.#samples.shift();
    return this.levelMs;
  }

  /**
   * True once the last `stabilitySamples` consecutive samples ALL measured at
   * or above `targetMs`. A burst that inflates a single poll is not a build —
   * the level must hold there.
   */
  isHoldingAtOrAbove(targetMs: number, stabilitySamples = 3): boolean {
    if (this.#samples.length < stabilitySamples) return false;
    return this.#samples.slice(-stabilitySamples).every((sample) => sample.levelMs >= targetMs);
  }

  /**
   * True once the level has been at or above `floorMs` for `plateauMs`
   * without growing by `growthMs` or more — the build has converged near its
   * asymptote, and the last stretch would cost seconds for a few percent of
   * extra headroom.
   */
  isPlateaued(floorMs: number, plateauMs: number, nowMs: number, growthMs = 40): boolean {
    const level = this.levelMs;
    if (level < floorMs) {
      this.#plateauBaseMs = null;
      return false;
    }
    if (this.#plateauBaseMs === null) {
      this.#plateauBaseMs = level;
      this.#plateauSinceMs = nowMs;
      return false;
    }
    if (level > this.#plateauBaseMs + growthMs) {
      this.#plateauBaseMs = level;
      this.#plateauSinceMs = nowMs;
      return false;
    }
    return nowMs - this.#plateauSinceMs >= plateauMs;
  }

  /** Reset for a fresh build (new track / new attach). */
  reset(): void {
    this.#samples = [];
    this.#plateauBaseMs = null;
    this.#plateauSinceMs = 0;
  }
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
