export interface MultiplayerClockSample {
  hostSentAt: number;
  clientReceivedAt: number;
  clientSentAt: number;
  hostReceivedAt: number;
}

export interface MultiplayerClockEstimate {
  clientOffsetMs: number;
  roundTripMs: number;
}

/**
 * Estimate client wall-clock offset with the same four timestamps used by NTP.
 * Positive offsets mean the client's clock is ahead of the host's clock.
 */
export function estimateMultiplayerClock(sample: MultiplayerClockSample): MultiplayerClockEstimate {
  const clientOffsetMs = (
    (sample.clientReceivedAt - sample.hostSentAt)
    + (sample.clientSentAt - sample.hostReceivedAt)
  ) / 2;
  const roundTripMs = Math.max(
    0,
    (sample.hostReceivedAt - sample.hostSentAt)
      - (sample.clientSentAt - sample.clientReceivedAt)
  );
  return { clientOffsetMs, roundTripMs };
}

export function clientStartTime(hostStartAt: number, clientOffsetMs: number): number {
  return hostStartAt + clientOffsetMs;
}

