interface LegacyPlayoutDelayReceiver {
  playoutDelayHint?: number | null;
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
